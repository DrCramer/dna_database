const {
  randomUUID
} = require('node:crypto');
const {
  pool
} = require('../../config/database');
const {
  validateObject,
  businessKey,
  analysisHash,
  hasGenotype,
  FORMAT
} = require('../../utils/objectImportV2');
const {
  createImportWorkbook
} = require('../../utils/importWorkbook');
const {
  parseFiles
} = require('./importSourceService');
const {
  seal,
  unseal
} = require('./workspaceCrypto');
const err = (message, status = 400, code = 'WORKSPACE_INVALID', details) => Object.assign(new Error(message), {
  status,
  code,
  details
});
const { WORKSPACE_WRITE_ROLES: WRITE_ROLES } = require('../../utils/objectTypes');
function requireUser(user, write = false) {
  if (!user?.id || !user.organization_id || user.is_active === false || ![...WRITE_ROLES, 'viewer'].includes(user.role)) throw err('Нет организационного контекста.', 403);
  if (write && !WRITE_ROLES.includes(user.role)) throw err('Нет права изменения личного массива.', 403);
}
function requireUpload(user) {
  requireUser(user, true);
  if (!(user.can_upload_with_task !== false || user.can_upload_without_task === true)) throw err('Нет права загрузки в личный массив.', 403);
}
const objectFromDB = p => ({
  id: p.id,
  objectNumber: p.internal_number,
  year: p.year,
  expertiseType: p.expertise_type,
  fullName: p.full_name || '',
  registrationNumber: p.registration_number,
  comment: p.comment || '',
  strData: p.str_data,
  analysisRevision: p.analysis_revision,
  provenance: p.provenance || {}
});
class WorkspaceService {
  constructor(databasePool = pool) {
    this.pool = databasePool;
  }
  async transaction(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async workspace(user, c = this.pool, lock = false) {
    requireUser(user);
    const result = await c.query(`INSERT INTO personal_workspaces(organization_id,owner_id) VALUES($1,$2) ON CONFLICT(organization_id,owner_id) DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING *`, [user.organization_id, user.id]);
    const w = result.rows[0];
    await c.query('INSERT INTO workspace_reference_versions(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [user.organization_id]);
    return w;
  }
  async list(user) {
    const w = await this.workspace(user);
    const {
      rows
    } = await this.pool.query(`SELECT p.*,pub.published_id,pub.destination,s.id search_id,s.state run_state,s.algorithm_version,proof.state proof_state,
 s.workspace_revision run_workspace_revision,s.master_revision,s.staff_revision,rv.master_revision current_master_revision,rv.staff_revision current_staff_revision
 FROM dna_profiles p JOIN workspace_reference_versions rv ON rv.organization_id=p.organization_id
 LEFT JOIN LATERAL(SELECT * FROM workspace_publications x WHERE x.workspace_profile_id=p.id AND x.analysis_revision=p.analysis_revision AND ((x.destination='master' AND EXISTS(SELECT 1 FROM master_array_profiles target WHERE target.id=x.published_id AND target.source_workspace_profile_id=p.id AND target.is_active=true)) OR (x.destination='staff' AND EXISTS(SELECT 1 FROM staff_profiles target WHERE target.id=x.published_id AND target.source_workspace_profile_id=p.id AND target.is_active=true))) ORDER BY x.created_at DESC LIMIT 1) pub ON true
 LEFT JOIN LATERAL(SELECT x.* FROM workspace_search_runs x JOIN workspace_search_profiles sp ON sp.search_run_id=x.id WHERE sp.profile_id=p.id AND x.workspace_id=$1 ORDER BY x.started_at DESC LIMIT 1) s ON true
 LEFT JOIN workspace_search_profiles proof ON proof.search_run_id=s.id AND proof.profile_id=p.id AND proof.analysis_revision=p.analysis_revision
 WHERE p.workspace_id=$1 AND p.user_id=$2 AND p.organization_id=$3 AND p.is_active=true ORDER BY p.upload_date,p.id`, [w.id, user.id, user.organization_id]);
    return {
      workspace: w,
      canEdit: WRITE_ROLES.includes(user.role),
      canUpload: WRITE_ROLES.includes(user.role) && (user.can_upload_with_task !== false || user.can_upload_without_task === true),
      canPublish: ['admin', 'system_administrator', 'department_head'].includes(user.role),
      canManageStaff: ['admin', 'system_administrator'].includes(user.role),
      profiles: rows.map(p => ({
        ...objectFromDB(p),
        publishedId: p.published_id,
        destination: p.destination,
        searchRunId: p.search_id,
        state: p.published_id ? 'PUBLISHED' : !hasGenotype(p.str_data) ? 'NO_GENOTYPE' : p.run_state === 'running' ? 'CHECKING' : p.algorithm_version === require('./workspaceSearchService').ALGORITHM_VERSION && p.proof_state === 'CHECKED' && p.run_workspace_revision === w.analysis_revision && p.master_revision === p.current_master_revision && p.staff_revision === p.current_staff_revision ? 'CHECKED' : p.search_id ? 'STALE' : 'NOT_CHECKED'
      }))
    };
  }
  async ownProfiles(c, user, w, ids, lock = false) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || new Set(ids).size !== ids.length) throw err('Выберите от 1 до 10000 уникальных профилей.');
    const {
      rows
    } = await c.query(`SELECT * FROM dna_profiles WHERE workspace_id=$1 AND user_id=$2 AND organization_id=$3 AND is_active=true AND id=ANY($4::uuid[]) ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [w.id, user.id, user.organization_id, ids]);
    if (rows.length !== ids.length) throw err('Один из профилей недоступен.', 403);
    return rows;
  }
  async patch(user, id, patch) {
    requireUser(user, true);
    const allowed = ['objectNumber', 'year', 'expertiseType', 'fullName', 'registrationNumber', 'comment', 'strData'];
    if (Object.keys(patch).some(k => !allowed.includes(k))) throw err('Неизвестное поле изменения.');
    return this.transaction(async c => {
      const w = await this.workspace(user, c, true);
      const [p] = await this.ownProfiles(c, user, w, [id], true),
        row = {
          ...objectFromDB(p),
          ...patch
        };
      const issues = validateObject(row);
      if (issues.length) throw err('Исправьте поля объекта.', 400, 'VALIDATION_FAILED', issues);
      await c.query(`UPDATE dna_profiles SET internal_number=$1,sample_name=$2,year=$3,expertise_type=$4,full_name=$5,registration_number=$6,comment=$7,str_data=$8,str_data_encrypted=NULL,sample_name_encrypted=NULL WHERE id=$9`, [row.objectNumber, row.expertiseType === 'staff' ? row.objectNumber : row.objectNumber.split('-')[0], row.year, row.expertiseType, row.fullName || null, row.expertiseType === 'staff' ? row.objectNumber : null, row.comment, JSON.stringify(row.strData), id]);
      return {
        id
      };
    });
  }
  async remove(user, ids) {
    requireUser(user, true);
    return this.transaction(async c => {
      const w = await this.workspace(user, c, true);
      await this.ownProfiles(c, user, w, ids, true);
      await c.query('UPDATE dna_profiles SET is_active=false,deactivated_by=$1,deactivated_at=now(),deactivation_reason=$2 WHERE id=ANY($3::uuid[])', [user.id, 'Удалено из личного массива', ids]);
      return {
        deleted: ids.length
      };
    });
  }
  async pruneDrafts() {
    return (await this.pool.query('DELETE FROM workspace_import_drafts WHERE expires_at<now() AND committed_at IS NULL')).rowCount;
  }
  async createDraft(user, files) {
    requireUpload(user);
    const w = await this.workspace(user),
      data = parseFiles(files);
    if (!data.rows.length) throw err('Нет именованных объектов для импорта.');
    const id = randomUUID();
    await this.pool.query(`INSERT INTO workspace_import_drafts(id,workspace_id,owner_id,organization_id,source_checksums,encrypted_payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')`, [id, w.id, user.id, user.organization_id, JSON.stringify(data.checksums), seal({
      rows: data.rows
    })]);
    return {
      id,
      revision: 1,
      rows: data.rows
    };
  }
  async draft(user, id, c = this.pool, lock = false) {
    requireUser(user);
    const {
      rows
    } = await c.query(`SELECT * FROM workspace_import_drafts WHERE id=$1 AND owner_id=$2 AND organization_id=$3 ${lock ? 'FOR UPDATE' : ''}`, [id, user.id, user.organization_id]);
    if (!rows.length) throw err('Черновик недоступен.', 404);
    const draft = rows[0];
    if (new Date(draft.expires_at) < new Date() && !draft.committed_at) throw err('Срок черновика истёк. Загрузите исходные файлы снова.', 410);
    return {
      ...draft,
      ...unseal(draft.encrypted_payload)
    };
  }
  async patchDraft(user, id, revision, patches) {
    requireUpload(user);
    return this.transaction(async c => {
      const d = await this.draft(user, id, c, true);
      if (d.committed_at) throw err('Черновик уже записан.', 409);
      if (d.revision !== revision) throw err('Черновик изменён в другой вкладке. Обновите данные.', 409);
      const map = new Map(d.rows.map(row => [row.draftRowId, row]));
      for (const patch of patches) {
        const row = map.get(patch.draftRowId);
        if (!row) throw err('Неизвестная строка черновика.');
        const allowed = ['draftRowId', 'included', 'objectNumber', 'year', 'expertiseType', 'fullName', 'registrationNumber', 'comment', 'strData'];
        if (Object.keys(patch).some(k => !allowed.includes(k))) throw err('Неизвестное поле строки.');
        if (patch.included === true && row.provenance.classification && !row.provenance.classification.included) throw err('Служебный образец нельзя включить как обычный объект.');
        if (patch.strData) {
          for (const [locus, value] of Object.entries(patch.strData)) {
            row.provenance.manualGenotypes = {
              ...row.provenance.manualGenotypes,
              [locus]: {
                previous: row.strData[locus],
                value
              }
            };
            row.sourceIssues = row.sourceIssues.filter(issue => issue.locus !== locus);
          }
        }
        Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'draftRowId')));
      }
      await c.query('UPDATE workspace_import_drafts SET encrypted_payload=$1,revision=revision+1 WHERE id=$2', [seal({
        rows: d.rows
      }), id]);
      return {
        id,
        revision: d.revision + 1,
        rows: d.rows
      };
    });
  }
  validateRows(rows) {
    const chosen = rows.filter(row => row.included),
      seen = new Map(),
      errors = [];
    for (const row of chosen) {
      const issues = [...row.sourceIssues, ...validateObject(row)];
      const key = businessKey(row);
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_OBJECT',
          message: 'Повтор типа, года и полного номера среди выбранных строк.'
        });
        errors.push({
          draftRowId: seen.get(key),
          issues: [{
            code: 'DUPLICATE_OBJECT',
            message: 'Повтор объекта в выбранных строках.'
          }]
        });
      }
      seen.set(key, row.draftRowId);
      if (issues.length) errors.push({
        draftRowId: row.draftRowId,
        issues
      });
    }
    if (!chosen.length) errors.push({
      issues: [{
        code: 'EMPTY_SELECTION',
        message: 'Выберите строки для загрузки.'
      }]
    });
    return {
      selected: chosen.length,
      total: rows.length,
      empty: chosen.filter(row => !hasGenotype(row.strData)).length,
      errors,
      valid: !errors.length
    };
  }
  async validateDraft(user, id, revision) {
    const d = await this.draft(user, id);
    if (d.revision !== revision) throw err('Версия черновика изменилась.', 409);
    return this.validateRows(d.rows);
  }
  async exportDraft(user, id, revision) {
    requireUser(user, true);
    const d = await this.draft(user, id);
    if (d.revision !== revision) throw err('Версия черновика изменилась.', 409);
    const result = this.validateRows(d.rows);
    if (!result.valid) throw err('Исправьте выбранные строки.', 400, 'VALIDATION_FAILED', result.errors);
    const profiles = d.rows.filter(row => row.included);
    return createImportWorkbook({
      profiles,
      loci: [...new Set(profiles.flatMap(row => Object.keys(row.strData)))],
      sourceFormat: FORMAT,
      hideEmptyLoci: true
    });
  }
  async commitDraft(user, id, revision, key) {
    requireUpload(user);
    return this.transaction(async c => {
      const w = await this.workspace(user, c, true),
        d = await this.draft(user, id, c, true);
      if (d.workspace_id !== w.id) throw err('Чужой массив.', 403);
      if (d.committed_at) {
        if (d.commit_key !== key) throw err('Черновик уже записан с другим ключом.', 409);
        return {
          ids: d.result_ids,
          replayed: true
        };
      }
      if (d.revision !== revision) throw err('Версия черновика изменилась.', 409);
      const result = this.validateRows(d.rows);
      if (!result.valid) throw err('Исправьте выбранные строки.', 400, 'VALIDATION_FAILED', result.errors);
      const ids = [];
      for (const row of d.rows.filter(r => r.included)) {
        const id = randomUUID();
        await c.query(`INSERT INTO dna_profiles(id,user_id,organization_id,workspace_id,year,internal_number,sample_name,str_data,import_format,expertise_type,full_name,registration_number,comment,provenance,file_source)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'genetic',$9,$10,$11,$12,$13,$14)`, [id, user.id, user.organization_id, w.id, row.year, row.objectNumber, row.expertiseType === 'staff' ? row.objectNumber : row.objectNumber.split('-')[0], JSON.stringify(row.strData), row.expertiseType, row.fullName || null, row.expertiseType === 'staff' ? row.objectNumber : null, row.comment, JSON.stringify({
          ...row.provenance,
          sourceSampleName: row.sourceSampleName,
          importDraftId: d.id,
          draftRowId: row.draftRowId
        }), row.sourceFilename]);
        ids.push(id);
      }
      await c.query('UPDATE workspace_import_drafts SET committed_at=now(),commit_key=$1,result_ids=$2 WHERE id=$3', [key, ids, id]);
      return {
        ids
      };
    });
  }
  async exportProfiles(user, ids) {
    requireUser(user, true);
    const w = await this.workspace(user),
      rows = await this.ownProfiles(this.pool, user, w, ids);
    const profiles = rows.map(objectFromDB);
    return createImportWorkbook({
      profiles,
      loci: [...new Set(profiles.flatMap(p => Object.keys(p.strData)))],
      sourceFormat: FORMAT,
      hideEmptyLoci: true
    });
  }
}
module.exports = {
  WorkspaceService,
  requireUser,
  requireUpload,
  objectFromDB,
  err
};

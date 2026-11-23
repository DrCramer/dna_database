const { WorkspaceApprovalService } = require('./workspaceApprovalService');
const { requireUser, err } = require('./workspaceService');
const { canRollbackMasterApproval } = require('../../utils/objectTypes');
const { hash } = require('../../utils/objectImportV2');
const { groupApprovalProblems } = require('../../utils/workspaceApprovalProblems');
const { unseal } = require('./workspaceCrypto');

const reasons = {
  CHANGED: ['Мастер-запись изменилась после публикации или больше не активна.', 'Проверьте более поздние публикации и актуальное состояние объекта.'],
  NO_PREVIOUS_VERSION: ['Прежняя версия мастер-записи отсутствует в журнале.', 'Для восстановления этой записи понадобится исходная выгрузка или резервная копия.'],
  NOT_VERIFIABLE: ['Текущую запись не удалось сверить с историей публикации.', 'Сверьте объект с сохранённой заявкой или резервной копией.']
};

function matchesLegacyPublication(row, saved) {
  return row.original_insert === true && saved && row.internal_number === saved.objectNumber &&
    row.year === saved.year && row.expertise_type === saved.expertiseType &&
    row.comment === saved.comment && hash(row.str_data) === hash(saved.strData) &&
    hash(row.metadata) === hash({ importFormat: 'genetic', provenance: saved.provenance });
}

class WorkspaceMasterRollbackService extends WorkspaceApprovalService {
  async rollbackActor(c, user, lock = false) {
    requireUser(user);
    const { rows: [actor] } = await c.query(`SELECT role,organization_id,is_active,can_approve_master FROM users
      WHERE id=$1 ${lock ? 'FOR SHARE' : ''}`, [user.id]);
    if (!actor?.is_active || actor.organization_id !== user.organization_id || !canRollbackMasterApproval(actor)) {
      throw err('Нет права отката публикаций мастер-массива.', 403, 'MASTER_ROLLBACK_FORBIDDEN');
    }
  }

  async masterPublicationList(user, page) {
    await this.rollbackActor(this.pool, user);
    // Key access stays scoped to the user's organization. Paging includes older publications.
    const { rows } = await this.pool.query(`SELECT a.id, a.submitted_at, a.decided_at,
        COALESCE(NULLIF(u.display_name,''),u.username) author_name, undo.rolled_back_at,
        CASE WHEN undo.approval_id IS NULL THEN 'approved' ELSE 'rolled_back' END state,
        (SELECT count(*)::int FROM workspace_master_approval_items i WHERE i.approval_id=a.id) profile_count
      FROM workspace_master_approvals a JOIN users u ON u.id=a.author_id
      LEFT JOIN workspace_master_rollbacks undo ON undo.approval_id=a.id
      WHERE a.organization_id=$1 AND a.state='approved'
      ORDER BY a.decided_at DESC,a.id DESC LIMIT 51 OFFSET $2`, [user.organization_id, (page - 1) * 50]);
    return { requests: rows.slice(0, 50), hasMore: rows.length > 50 };
  }

  async rollbackRequest(c, user, id, lock = false) {
    const { rows: [approval] } = await c.query(`SELECT a.id, a.workspace_id, a.organization_id, a.state, a.decided_at, a.decided_by,
        COALESCE(NULLIF(u.display_name,''),u.username) author_name
      FROM workspace_master_approvals a JOIN users u ON u.id=a.author_id
      WHERE a.id=$1 AND a.organization_id=$2 ${lock ? 'FOR UPDATE OF a' : ''}`, [id, user.organization_id]);
    if (!approval) throw err('Заявка недоступна.', 404);
    return approval;
  }

  async readRollbackPlan(c, approval, lock = false) {
    const { rows: [receipt] } = await c.query(`SELECT undo.rolled_back_at AS "rolledBackAt", undo.reason,
        undo.removed_count AS removed, undo.restored_count AS restored,
        COALESCE(NULLIF(u.display_name,''),u.username) AS "rolledBackBy"
      FROM workspace_master_rollbacks undo JOIN users u ON u.id=undo.rolled_back_by
      WHERE undo.approval_id=$1`, [approval.id]);
    const header = { id: approval.id, authorName: approval.author_name, decidedAt: approval.decided_at };
    if (receipt) return { ...header, state: 'rolled_back', receipt };
    if (approval.state !== 'approved') throw err('Откат доступен для опубликованных заявок.', 409, 'APPROVAL_NOT_PUBLISHED');
    if (lock) {
      await c.query(`SELECT m.id FROM master_array_profiles m JOIN workspace_master_approval_items i ON i.target_id=m.id
        WHERE i.approval_id=$1 AND m.organization_id=$2 ORDER BY m.id FOR UPDATE OF m`, [approval.id, approval.organization_id]);
    }
    const { rows } = await c.query(`SELECT i.profile_id, i.target_id, i.replace_existing, pub.id AS publication_id,
        version.applied_hash, version.previous_record IS NOT NULL AS has_previous,
        workspace_master_row_hash(to_jsonb(m)) AS current_hash, latest.id AS latest_id,
        m.is_active, m.internal_number, m.year, m.expertise_type,
        CASE WHEN version.publication_id IS NULL THEN m.str_data END str_data,
        CASE WHEN version.publication_id IS NULL THEN m.comment END comment,
        CASE WHEN version.publication_id IS NULL THEN m.metadata END metadata,
        (m.source_workspace_profile_id=i.profile_id AND m.created_by=$3 AND m.updated_at=m.created_at
          AND m.sample_name=source.sample_name AND m.import_number IS NULL AND m.str_data_encrypted IS NULL
          AND m.sample_name_encrypted IS NULL AND m.metadata_encrypted IS NULL AND m.encrypted_at IS NULL) original_insert
      FROM workspace_master_approval_items i
      LEFT JOIN workspace_publications pub ON pub.id=i.publication_id AND pub.master_approval_id=i.approval_id
        AND pub.organization_id=$2 AND pub.destination='master' AND pub.published_id=i.target_id AND pub.workspace_profile_id=i.profile_id
      LEFT JOIN workspace_master_publication_versions version ON version.publication_id=pub.id
      LEFT JOIN master_array_profiles m ON m.id=i.target_id AND m.organization_id=$2
      LEFT JOIN dna_profiles source ON source.id=i.profile_id AND source.organization_id=$2
      LEFT JOIN LATERAL (
        SELECT other.id FROM workspace_publications other
        JOIN workspace_master_approvals a ON a.id=other.master_approval_id AND a.state='approved'
        LEFT JOIN workspace_master_rollbacks undo ON undo.approval_id=a.id
        LEFT JOIN workspace_master_publication_versions newer ON newer.publication_id=other.id
        WHERE other.organization_id=$2 AND other.published_id=i.target_id AND other.destination='master' AND other.master_approval_id IS NOT NULL
          AND undo.approval_id IS NULL
        ORDER BY newer.ordinal DESC NULLS LAST,a.decided_at DESC,other.id DESC LIMIT 1
      ) latest ON true
      WHERE i.approval_id=$1 ORDER BY i.profile_id`, [approval.id, approval.organization_id, approval.decided_by]);

    let historical = new Map();
    if (rows.some(row => !row.applied_hash && !row.replace_existing)) {
      const { rows: [{ encrypted_decision: decision }] } = await c.query(
        'SELECT encrypted_decision FROM workspace_master_approvals WHERE id=$1', [approval.id]);
      try { if (decision) historical = new Map(unseal(decision).profiles.map(profile => [profile.id, profile])); }
      catch { /* Older records without readable evidence are reported as blocked below. */ }
    }
    const problems = [], profiles = [];
    let removed = 0, restored = 0;
    for (const row of rows) {
      const saved = historical.get(row.profile_id);
      const profile = {
        profileId: row.profile_id, objectNumber: row.internal_number || saved?.objectNumber,
        year: row.year ?? saved?.year, expertiseType: row.expertise_type || saved?.expertiseType
      };
      let code;
      if (!row.publication_id || row.publication_id !== row.latest_id || !row.is_active) code = 'CHANGED';
      else if (row.applied_hash && row.applied_hash !== row.current_hash) code = 'CHANGED';
      else if (row.replace_existing && (!row.applied_hash || !row.has_previous)) code = 'NO_PREVIOUS_VERSION';
      else if (!row.applied_hash && !matchesLegacyPublication(row, saved)) code = 'NOT_VERIFIABLE';
      if (code) {
        const [message, instruction] = reasons[code];
        problems.push({ ...profile, code, message, instruction });
      } else {
        profiles.push({ ...profile, action: row.replace_existing ? 'restore' : 'remove' });
        if (row.replace_existing) restored++; else removed++;
      }
    }
    if (!rows.length) throw err('В заявке нет записей для отката.', 409, 'APPROVAL_ROLLBACK_EMPTY');
    const reviewToken = problems.length ? null : hash(rows.map(row => [row.publication_id, row.current_hash]));
    return { ...header, state: 'approved', reviewToken, removed, restored, profiles, groups: groupApprovalProblems(problems) };
  }

  async masterRollbackPreview(user, id) {
    return this.transaction(async c => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.rollbackActor(c, user);
      return this.readRollbackPlan(c, await this.rollbackRequest(c, user, id));
    });
  }

  async rollbackMasterApproval(user, id, reviewToken, reason) {
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw err('Укажите причину отката.');
    return this.transaction(async c => {
      await this.rollbackActor(c, user, true);
      const header = await this.rollbackRequest(c, user, id);
      await c.query('SELECT id FROM personal_workspaces WHERE id=$1 FOR UPDATE', [header.workspace_id]);
      const approval = await this.rollbackRequest(c, user, id, true);
      await c.query('SELECT organization_id FROM workspace_reference_versions WHERE organization_id=$1 FOR UPDATE', [user.organization_id]);
      const plan = await this.readRollbackPlan(c, approval, true);
      if (plan.state === 'rolled_back') return { ...plan, replayed: true };
      if (plan.groups.length) throw err('Заявку нельзя откатить целиком.', 409, 'APPROVAL_ROLLBACK_BLOCKED', { groups: plan.groups });
      if (reviewToken !== plan.reviewToken) throw err('Данные изменились. Проверьте обновлённый план отката.', 409, 'REVIEW_STALE');

      await c.query(`INSERT INTO workspace_master_rollbacks(approval_id,rolled_back_by,reason,removed_count,restored_count)
        VALUES($1,$2,$3,$4,$5)`, [id, user.id, reason.trim(), plan.removed, plan.restored]);
      await c.query("SELECT set_config('app.workspace_rollback_batch_id',$1,true)", [id]);
      const removed = await c.query(`UPDATE master_array_profiles m SET is_active=false
        WHERE m.organization_id=$2 AND m.id=ANY(ARRAY(
          SELECT target_id FROM workspace_master_approval_items WHERE approval_id=$1 AND NOT replace_existing
        ))`,
      [id, user.organization_id]);
      let restoredCount = 0;
      if (plan.restored) {
        await c.query("SELECT set_config('app.workspace_restore_approval_id',$1,true)", [id]);
        const updated = await c.query(`UPDATE master_array_profiles m
          SET (source_workspace_profile_id,internal_number,sample_name,year,expertise_type,comment,str_data,metadata,
               str_data_encrypted,sample_name_encrypted,metadata_encrypted) =
              (saved.source_workspace_profile_id,saved.internal_number,saved.sample_name,saved.year,saved.expertise_type,
               saved.comment,saved.str_data,saved.metadata,saved.str_data_encrypted,saved.sample_name_encrypted,saved.metadata_encrypted)
          FROM workspace_master_approval_items i
          JOIN workspace_master_publication_versions v ON v.publication_id=i.publication_id
          CROSS JOIN LATERAL jsonb_populate_record(NULL::master_array_profiles,v.previous_record) saved
          WHERE i.approval_id=$1 AND i.replace_existing AND m.id=i.target_id AND m.organization_id=$2`, [id, user.organization_id]);
        restoredCount = updated.rowCount;
      }
      if (removed.rowCount !== plan.removed || restoredCount !== plan.restored) throw err('Состав заявки изменился. Откат отменён.', 409, 'REVIEW_STALE');
      // Metadata-only replacements also require reanalysis after a rollback.
      await c.query('UPDATE workspace_reference_versions SET master_revision=master_revision+1 WHERE organization_id=$1', [user.organization_id]);
      return this.readRollbackPlan(c, approval);
    });
  }
}

module.exports = { WorkspaceMasterRollbackService };

const {
  randomUUID
} = require('node:crypto');
const {
  WorkspaceService,
  requireUser,
  objectFromDB,
  err
} = require('./workspaceService');
const {
  analysisHash,
  hasGenotype
} = require('../../utils/objectImportV2');
const {
  informativeAlleles
} = require('../../utils/alleleTokens');
const {
  runProfileSearch
} = require('../profiles/searchWorkerExecutor');
const { runStaffSearch } = require('../contamination/staffSearchWorkerExecutor');
const { staffSearchOptions } = require('../../utils/staffSearchOptions');
const {
  decodeMasterRow
} = require('../converters/masterArrayExcelExportService');
const {
  seal,
  unseal
} = require('./workspaceCrypto');
const ALGORITHM_VERSION = 'existing-task-comparison+staff-v5/workspace-1';
class WorkspaceSearchService extends WorkspaceService {
  async configureSearch(user, parameters) {
    requireUser(user, true);
    return this.transaction(async client => {
      const workspace = await this.workspace(user, client, true);
      const effective = {
        minMatches: 15,
        ignoredLoci: [],
        comparisonAlgorithm: 'standard',
        ...workspace.analysis_parameters,
        ...parameters
      };
      effective.staffOptions = staffSearchOptions(parameters.staffOptions ?? workspace.analysis_parameters.staffOptions);
      await client.query('UPDATE personal_workspaces SET analysis_parameters=$1,analysis_revision=analysis_revision+1 WHERE id=$2 AND analysis_parameters IS DISTINCT FROM $1::jsonb', [JSON.stringify(effective), workspace.id]);
      return effective;
    });
  }
  async fullSearch(user, ids, parameters = {}, signal, onProgress) {
    const progressSink = onProgress;
    onProgress = progress => { try { progressSink?.(progress); } catch { /* Telemetry cannot invalidate a committed search. */ } };
    requireUser(user, true);
    onProgress?.({ stage: 'preparing', status: 'running' });
    parameters = await this.configureSearch(user, parameters);
    requireUser(user, true);
    const w = await this.workspace(user),
      id = randomUUID(),
      reader = await this.pool.connect();
    let run, profiles, working, master, staff, staffLinks;
    try {
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const workspace = (await reader.query('SELECT * FROM personal_workspaces WHERE id=$1', [w.id])).rows[0];
      profiles = await this.ownProfiles(reader, user, w, ids);
      working = (await reader.query('SELECT * FROM dna_profiles WHERE workspace_id=$1 AND user_id=$2 AND organization_id=$3 AND is_active=true', [w.id, user.id, user.organization_id])).rows;
      const refs = (await reader.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1', [user.organization_id])).rows[0];
      master = (await reader.query(`SELECT p.* FROM master_array_profiles p JOIN master_arrays ma ON ma.id=p.master_array_id WHERE p.organization_id=$1 AND p.is_active=true AND ma.is_active=true`, [user.organization_id])).rows.map(row => decodeMasterRow(row));
      const legacyMasters = (await reader.query("SELECT * FROM dna_profiles WHERE organization_id=$1 AND is_active=true AND profile_type='master'", [user.organization_id])).rows.map(row => decodeMasterRow(row));
      master.push(...legacyMasters);
      staff = (await reader.query('SELECT * FROM staff_profiles WHERE organization_id=$1 AND is_active=true ORDER BY full_name,id', [user.organization_id])).rows;
      // Only the exact current published revision can exclude a self-reference.
      // Read all links once, in the same scoped snapshot as the reference arrays.
      staffLinks = (await reader.query(`SELECT pub.workspace_profile_id,pub.published_id
        FROM workspace_publications pub
        JOIN staff_profiles target ON target.id=pub.published_id
        JOIN dna_profiles source ON source.id=pub.workspace_profile_id
        WHERE source.id=ANY($1::uuid[]) AND source.workspace_id=$2 AND source.user_id=$3
          AND source.organization_id=$4 AND pub.organization_id=$4 AND target.organization_id=$4
          AND pub.analysis_revision=source.analysis_revision AND pub.destination='staff'
          AND target.source_workspace_profile_id=source.id AND target.str_data=source.str_data
          AND target.year=source.year AND target.registration_number IS NOT DISTINCT FROM source.internal_number`,
      [profiles.map(profile => profile.id), w.id, user.id, user.organization_id])).rows;
      run = {
        id,
        workspace_id: w.id,
        workspace_revision: workspace.analysis_revision,
        master_revision: refs.master_revision,
        staff_revision: refs.staff_revision
      };
      await reader.query('COMMIT');
    } catch (e) {
      await reader.query('ROLLBACK');
      throw e;
    } finally {
      reader.release();
    }
    await this.pool.query(`INSERT INTO workspace_search_runs(id,workspace_id,owner_id,organization_id,algorithm_version,state,parameters,workspace_revision,master_revision,staff_revision)
   VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8,$9)`, [id, w.id, user.id, user.organization_id, ALGORITHM_VERSION, JSON.stringify(parameters), run.workspace_revision, run.master_revision, run.staff_revision]);
    try {
      const hashes = new Map(profiles.map(profile => [profile.id, analysisHash(objectFromDB(profile))]));
      await this.pool.query(`INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages)
        SELECT $1,p.id,p.revision,p.hash,'PENDING','{}'::jsonb
        FROM jsonb_to_recordset($2::jsonb) AS p(id uuid,revision bigint,hash text)`,
      [id, JSON.stringify(profiles.map(profile => ({ id: profile.id, revision: profile.analysis_revision, hash: hashes.get(profile.id) })))]);
      if (signal?.aborted) throw err('Поиск отменён.', 409, 'CANCELLED');
      const eligible = profiles.filter(p => hasGenotype(p.str_data));
      const input = {
        referenceProfiles: eligible,
        minMatches: parameters.minMatches ?? 15,
        ignoredLoci: parameters.ignoredLoci || [],
        comparisonAlgorithm: parameters.comparisonAlgorithm || 'standard',
        useV5Algorithm: true,
        duplicateSettings: parameters.duplicateSettings || {}
      };
      const stageProgress = stage => progressSink ? progress => onProgress({ stage, ...progress }) : undefined;
      onProgress?.({ stage: 'internal', status: 'running', completed: 0, total: eligible.length, unit: 'objects' });
      const internal = await runProfileSearch({
        ...input,
        compareProfiles: working,
        searchMode: 'task'
      }, {
        signal, onProgress: stageProgress('internal')
      });
      onProgress?.({ stage: 'master', status: 'running', completed: 0, total: eligible.length, unit: 'objects' });
      const shared = await runProfileSearch({
        ...input,
        compareProfiles: master,
        searchMode: 'workspace_master'
      }, {
        signal, onProgress: stageProgress('master')
      });
      const exclusions = new Map();
      for (const link of staffLinks) {
        if (!exclusions.has(link.workspace_profile_id)) exclusions.set(link.workspace_profile_id, []);
        exclusions.get(link.workspace_profile_id).push(link.published_id);
      }
      onProgress?.({ stage: 'staff', status: 'running', completed: 0, total: eligible.length, unit: 'objects' });
      const staffResult = await runStaffSearch({ referenceProfiles: eligible, staffProfiles: staff,
        excludedStaffIds: [...exclusions], options: parameters.staffOptions }, { signal, onProgress: stageProgress('staff') });
      // Match the main analyze-task route's final threshold filter, including
      // its fallback when a legacy saved threshold is zero.
      const staffThreshold = parameters.staffOptions.threshold || 5.5;
      for (const group of staffResult.results) group.matches = group.matches.filter(match => match.finalScore >= staffThreshold);
      const needed = input.comparisonAlgorithm === 'duplicate_v5' ? input.duplicateSettings.minLoci ?? 15 : input.minMatches;
      const proofs = profiles.map(p => {
        const count = Object.entries(p.str_data).filter(([locus, value]) => !input.ignoredLoci.includes(locus) && informativeAlleles(value).length).length;
        const staffCount = Object.entries(p.str_data).filter(([locus, value]) => !parameters.staffOptions.ignoredLoci.includes(locus) && informativeAlleles(value).length).length;
        return {
          profileId: p.id,
          analysisRevision: p.analysis_revision,
          hash: hashes.get(p.id),
          state: !hasGenotype(p.str_data) ? 'NO_GENOTYPE' : count < needed || staffCount < parameters.staffOptions.minLociMatch ? 'INSUFFICIENT_DATA' : 'CHECKED',
          comparedLoci: count
        };
      });
      const sourceById = new Map(profiles.map(profile => [profile.id, profile]));
      const workingById = new Map(working.map(profile => [profile.id, profile]));
      for (const stage of [internal, shared]) for (const group of stage.results) {
        group.reference.str_data = sourceById.get(group.reference.id)?.str_data || {};
        const source = sourceById.get(group.reference.id);
        if (source?.expertise_type === 'staff' && !source.internal_number) group.reference.full_name = source.full_name;
        for (const match of [...(group.matches || []), ...(group.exportMatches || [])]) {
          const compared = workingById.get(match.id);
          if (compared?.expertise_type === 'staff' && !compared.internal_number) match.full_name = compared.full_name;
        }
      }
      // Preserve raw genotypes from the same scoped search snapshot, once per
      // matched staff member. Worker scores/details remain unchanged.
      const matchedStaff = new Set();
      for (const group of staffResult.results) for (const match of group.matches) matchedStaff.add(match.staffId);
      const staffGroups = staffResult.results.map(group => {
        if (!group.matches.length) return group;
        const p = sourceById.get(group.profileId);
        return { ...group, reference: { id: p.id, internal_number: p.internal_number, year: p.year, str_data: p.str_data, ...(!p.internal_number && p.expertise_type === 'staff' ? { full_name: p.full_name } : {}) } };
      });
      const staffProfiles = staff.filter(profile => matchedStaff.has(profile.id)).map(p => ({
        id: p.id, internal_number: p.registration_number || (p.source_workspace_profile_id ? '' : p.staff_id),
        full_name: p.full_name, year: p.year, str_data: p.str_data
      }));
      const result = {
        id,
        algorithmVersion: ALGORITHM_VERSION,
        parameters,
        internal,
        master: shared,
        staff: staffGroups,
        staffProfiles,
        staffExecution: { mode: staffResult.mode, workerCount: staffResult.workerCount, comparisons: staffResult.comparisons },
        profiles: proofs,
        referenceCounts: {
          master: master.length,
          staff: staff.length,
          workspace: working.length
        }
      };
      onProgress?.({ stage: 'saving', status: 'running' });
      await this.transaction(async c => {
        const current = await this.workspace(user, c, true);
        const refs = (await c.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1 FOR UPDATE', [user.organization_id])).rows[0];
        if (current.analysis_revision !== run.workspace_revision || refs.master_revision !== run.master_revision || refs.staff_revision !== run.staff_revision) throw err('Данные изменились во время поиска. Повторите полный поиск.', 409, 'SEARCH_STALE');
        if (signal?.aborted) throw err('Поиск отменён.', 409, 'CANCELLED');
        const finalProofs = proofs.map(proof => ({ profile_id: proof.profileId, revision: proof.analysisRevision, hash: proof.hash, state: proof.state, stages: proof.state === 'CHECKED' ? {
          internal: true,
          master: true,
          staff: true
        } : {
          internal: false,
          master: false,
          staff: false
        } }));
        await c.query(`INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages)
          SELECT $1,p.profile_id,p.revision,p.hash,p.state,p.stages
          FROM jsonb_to_recordset($2::jsonb) AS p(profile_id uuid,revision bigint,hash text,state text,stages jsonb)
          ON CONFLICT(search_run_id,profile_id) DO UPDATE SET state=EXCLUDED.state,stages=EXCLUDED.stages`, [id, JSON.stringify(finalProofs)]);
        await c.query("UPDATE workspace_search_runs SET state='complete',completed_at=now(),encrypted_result=$1 WHERE id=$2", [seal(result), id]);
      });
      onProgress?.({ stage: 'complete', status: 'running' });
      return result;
    } catch (e) {
      await this.pool.query("UPDATE workspace_search_runs SET state=$1,error_code=$2,completed_at=now() WHERE id=$3", [signal?.aborted ? 'cancelled' : 'failed', e.code || 'SEARCH_FAILED', id]);
      throw e;
    }
  }
  async search(user, id) {
    requireUser(user);
    const {
      rows
    } = await this.pool.query('SELECT * FROM workspace_search_runs WHERE id=$1 AND owner_id=$2 AND organization_id=$3', [id, user.id, user.organization_id]);
    if (!rows.length) throw err('Поиск недоступен.', 404);
    const run = rows[0];
    return {
      id: run.id,
      state: run.state,
      errorCode: run.error_code,
      ...(run.encrypted_result ? unseal(run.encrypted_result) : {})
    };
  }
  async publicationPreview(user, ids) {
    requireUser(user);
    const w = await this.workspace(user),
      profiles = await this.ownProfiles(this.pool, user, w, ids),
      conflicts = [];
    for (const p of profiles) {
      const destination = p.expertise_type === 'staff' ? 'staff' : 'master';
      const targets = destination === 'staff' ? await this.pool.query('SELECT id FROM staff_profiles WHERE organization_id=$1 AND year=$2 AND lower(registration_number)=lower($3) AND is_active=true', [user.organization_id, p.year, p.internal_number]) : await this.pool.query('SELECT id FROM master_array_profiles WHERE organization_id=$1 AND year=$2 AND expertise_type=$3 AND lower(btrim(internal_number))=lower(btrim($4)) AND is_active=true', [user.organization_id, p.year, p.expertise_type, p.internal_number]);
      const linked = (await this.pool.query(`SELECT pub.published_id FROM workspace_publications pub WHERE pub.workspace_profile_id=$1 AND ((pub.destination='master' AND EXISTS(SELECT 1 FROM master_array_profiles target WHERE target.id=pub.published_id AND target.source_workspace_profile_id=$1 AND target.is_active=true)) OR (pub.destination='staff' AND EXISTS(SELECT 1 FROM staff_profiles target WHERE target.id=pub.published_id AND target.source_workspace_profile_id=$1 AND target.is_active=true))) ORDER BY created_at DESC LIMIT 1`, [p.id])).rows[0]?.published_id;
      for (const target of targets.rows) if (target.id !== linked) conflicts.push({
        profileId: p.id,
        objectNumber: p.internal_number,
        year: p.year,
        expertiseType: p.expertise_type,
        destination,
        publishedId: target.id
      });
    }
    return {
      conflicts
    };
  }
  async publish(user, ids, searchRunId, existingTargets = {}) {
    requireUser(user, true);
    if (!['admin', 'system_administrator', 'department_head'].includes(user.role)) throw err('Нет права публикации в общий массив.', 403);
    return this.transaction(async c => {
      const w = await this.workspace(user, c, true),
        profiles = await this.ownProfiles(c, user, w, ids, true);
      if (profiles.some(p => p.expertise_type !== 'staff')) throw err('Для мастер-массива требуется отправка заявки и подтверждение другого пользователя.', 409, 'MASTER_APPROVAL_REQUIRED');
      const refs = (await c.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1 FOR UPDATE', [user.organization_id])).rows[0];
      const history = (await c.query("SELECT pub.* FROM workspace_publications pub WHERE pub.workspace_profile_id=ANY($1::uuid[]) AND ((pub.destination='master' AND EXISTS(SELECT 1 FROM master_array_profiles target WHERE target.id=pub.published_id AND target.source_workspace_profile_id=pub.workspace_profile_id AND target.is_active=true)) OR (pub.destination='staff' AND EXISTS(SELECT 1 FROM staff_profiles target WHERE target.id=pub.published_id AND target.source_workspace_profile_id=pub.workspace_profile_id AND target.is_active=true))) ORDER BY pub.created_at DESC", [ids])).rows;
      const existing = [...new Map(history.map(pub => [pub.workspace_profile_id + ':' + pub.analysis_revision, pub]).reverse()).values()];
      const pending = profiles.filter(p => !existing.some(pub => pub.workspace_profile_id === p.id && pub.analysis_revision === p.analysis_revision));
      for (const p of profiles) {
        if (p.expertise_type === 'staff' && !['admin', 'system_administrator'].includes(user.role)) throw err('Массив сотрудников изменяет только администратор.', 403);
        const linked = existing.find(pub => pub.workspace_profile_id === p.id && pub.analysis_revision === p.analysis_revision);
        if (linked) {
          if (linked.destination === 'staff') await c.query('UPDATE staff_profiles SET full_name=$1,comment=$2 WHERE id=$3 AND organization_id=$4', [p.full_name, p.comment, linked.published_id, user.organization_id]);else await c.query('UPDATE master_array_profiles SET comment=$1 WHERE id=$2 AND organization_id=$3', [p.comment, linked.published_id, user.organization_id]);
        }
      }
      if (!pending.length) return {
        published: existing.filter(pub => profiles.some(p => p.id === pub.workspace_profile_id && p.analysis_revision === pub.analysis_revision)),
        replayed: true
      };
      const run = (await c.query("SELECT * FROM workspace_search_runs WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND organization_id=$4 AND state='complete'", [searchRunId, w.id, user.id, user.organization_id])).rows[0];
      if (!run || run.algorithm_version !== ALGORITHM_VERSION || run.workspace_revision !== w.analysis_revision || run.master_revision !== refs.master_revision || run.staff_revision !== refs.staff_revision) throw err('Нужен актуальный полный поиск выбранных объектов.', 409, 'FULL_SEARCH_REQUIRED');
      const proofs = (await c.query('SELECT * FROM workspace_search_profiles WHERE search_run_id=$1', [run.id])).rows;
      for (const p of pending) {
        const proof = proofs.find(x => x.profile_id === p.id);
        if (!proof || proof.state !== 'CHECKED' || proof.analysis_revision !== p.analysis_revision || proof.analysis_hash !== analysisHash(objectFromDB(p))) throw err('Не все выбранные профили проверены для текущей версии.', 409, 'FULL_SEARCH_REQUIRED');
        if (validateMetadata(p).length) throw err('Некорректные метаданные публикации.');
        if (p.expertise_type === 'staff' && !['admin', 'system_administrator'].includes(user.role)) throw err('Массив сотрудников изменяет только администратор.', 403);
      }
      const published = [];
      for (const p of pending) {
        const prior = existing.find(pub => pub.workspace_profile_id === p.id),
          destination = p.expertise_type === 'staff' ? 'staff' : 'master',
          target = existingTargets[p.id] || (prior?.destination === destination ? prior.published_id : randomUUID()),
          publication = randomUUID();
        if (prior && prior.destination !== destination) throw err('Изменено назначение опубликованного объекта. Сначала требуется явное решение по прежней опубликованной записи.', 409, 'PUBLICATION_DESTINATION_CONFLICT');
        // Resolve all business conflicts explicitly; different owners never create a second shared identity.
        const conflict = destination === 'staff' ? await c.query('SELECT id FROM staff_profiles WHERE organization_id=$1 AND year=$2 AND lower(registration_number)=lower($3) AND is_active=true AND id<>$4', [user.organization_id, p.year, p.internal_number, target]) : await c.query('SELECT id FROM master_array_profiles WHERE organization_id=$1 AND year=$2 AND expertise_type=$3 AND lower(btrim(internal_number))=lower(btrim($4)) AND is_active=true AND id<>$5', [user.organization_id, p.year, p.expertise_type, p.internal_number, target]);
        if (conflict.rows.length) throw err('В общем массиве уже есть объект с таким типом, годом и номером. Требуется явное сопоставление.', 409, 'BUSINESS_CONFLICT');
        const replacement = !!existingTargets[p.id];
        if (replacement) {
          const allowed = destination === 'staff' ? await c.query('SELECT id FROM staff_profiles WHERE id=$1 AND organization_id=$2 AND year=$3 AND lower(registration_number)=lower($4) AND is_active=true', [target, user.organization_id, p.year, p.internal_number]) : await c.query('SELECT id FROM master_array_profiles WHERE id=$1 AND organization_id=$2 AND year=$3 AND expertise_type=$4 AND lower(btrim(internal_number))=lower(btrim($5)) AND is_active=true', [target, user.organization_id, p.year, p.expertise_type, p.internal_number]);
          if (!allowed.rows.length) throw err('Выбранная опубликованная запись не соответствует объекту.', 403);
        }
        await c.query(`INSERT INTO workspace_publications(id,workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [publication, p.id, p.analysis_revision, user.organization_id, run.id, destination, target, user.id]);
        await c.query("SELECT set_config('app.workspace_publication_id',$1,true)", [publication]);
        if (destination === 'staff') {
          if (prior?.destination === 'staff' || replacement) await c.query('UPDATE staff_profiles SET source_workspace_profile_id=$9,registration_number=$1,staff_id=COALESCE(staff_id,$2),year=$3,full_name=$4,comment=$5,str_data=$6,last_updated=now() WHERE id=$7 AND organization_id=$8', [p.internal_number, `workspace-${target}`, p.year, p.full_name, p.comment, JSON.stringify(p.str_data), target, user.organization_id, p.id]);else await c.query(`INSERT INTO staff_profiles(id,staff_id,registration_number,year,full_name,comment,str_data,organization_id,created_by,source_workspace_profile_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [target, `workspace-${target}`, p.internal_number, p.year, p.full_name, p.comment, JSON.stringify(p.str_data), user.organization_id, user.id, p.id]);
        } else {
          const array = (await c.query(`INSERT INTO master_arrays(organization_id,organization_default,name,description) VALUES($1,true,'Общий мастер-массив','Опубликованные профили организации') ON CONFLICT(organization_id) WHERE organization_default=true DO UPDATE SET organization_default=true RETURNING id`, [user.organization_id])).rows[0].id;
          if (prior?.destination === 'master' || replacement) await c.query('UPDATE master_array_profiles SET source_workspace_profile_id=$10,internal_number=$1,sample_name=$2,year=$3,expertise_type=$4,comment=$5,str_data=$6,metadata=$7,str_data_encrypted=NULL,sample_name_encrypted=NULL,metadata_encrypted=NULL WHERE id=$8 AND organization_id=$9', [p.internal_number, p.sample_name, p.year, p.expertise_type, p.comment, JSON.stringify(p.str_data), JSON.stringify({
            importFormat: 'genetic',
            provenance: p.provenance
          }), target, user.organization_id, p.id]);else await c.query(`INSERT INTO master_array_profiles(id,master_array_id,year,sample_name,internal_number,str_data,metadata,created_by,organization_id,expertise_type,comment,source_workspace_profile_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [target, array, p.year, p.sample_name, p.internal_number, JSON.stringify(p.str_data), JSON.stringify({
            importFormat: 'genetic',
            provenance: p.provenance
          }), user.id, user.organization_id, p.expertise_type, p.comment, p.id]);
        }
        published.push({
          profileId: p.id,
          publishedId: target,
          destination,
          searchRunId: run.id
        });
      }
      return {
        published: [...published, ...existing.filter(pub => profiles.some(p => p.id === pub.workspace_profile_id && p.analysis_revision === pub.analysis_revision))]
      };
    });
  }
}
function validateMetadata(p) {
  return require('../../utils/objectImportV2').validateObject(objectFromDB(p));
}
module.exports = {
  WorkspaceSearchService,
  ALGORITHM_VERSION
};

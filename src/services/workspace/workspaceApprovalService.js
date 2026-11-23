const { randomUUID } = require('node:crypto');
const { WorkspaceSearchService, ALGORITHM_VERSION } = require('./workspaceSearchService');
const { requireUser, objectFromDB, isMasterApprovalProof, err } = require('./workspaceService');
const { analysisHash, hash, validateObject, hasGenotype } = require('../../utils/objectImportV2');
const { seal, unseal } = require('./workspaceCrypto');
const { groupApprovalProblems } = require('../../utils/workspaceApprovalProblems');
const searchInstruction = 'Закройте окно и нажмите «Полный поиск выбранных» для всей заявки.';
const problemReasons = {
  REMOVED: ['Объект удалён из личного массива.', 'Уберите объект из заявки.'],
  STAFF: ['Эталоны сотрудников публикуются отдельно.', 'Уберите эталоны сотрудников из заявки в мастер-массив.'],
  NO_SEARCH: ['Объекты не входили ни в один полный поиск.', searchInstruction],
  SEARCH_INCOMPLETE: ['Последний поиск не завершён.', searchInstruction],
  ALGORITHM_CHANGED: ['После поиска обновились критерии сравнения.', searchInstruction],
  MASTER_CHANGED: ['После поиска обновился мастер-массив.', searchInstruction],
  STAFF_CHANGED: ['После поиска обновились эталоны сотрудников.', searchInstruction],
  WORKSPACE_CHANGED: ['После поиска изменились объекты или настройки личного массива.', searchInstruction],
  PROFILE_CHANGED: ['После поиска изменилась версия объекта.', searchInstruction],
  SEPARATE_RUNS: ['Для выбранных объектов нет одного общего актуального поиска.', searchInstruction],
  PENDING: ['Объекты уже на подтверждении.', 'Дождитесь решения по предыдущей заявке или уберите эти объекты из выбора.'],
  REQUEST_CHANGED: ['Объекты изменились после отправки заявки.', 'Верните заявку. Автор сможет выполнить поиск и отправить её заново.'],
  TARGET_CHANGED: ['Связанные записи в мастер-массиве изменились.', 'Верните заявку для повторного сопоставления.'],
  TARGET_CONFLICT: ['В мастер-массиве уже есть записи с такими номерами.', 'Откройте предпросмотр заново и подтвердите сопоставление.'],
  EMPTY_REPLACEMENT: ['Объект без генотипа нельзя использовать для замены существующего генотипа.', 'Уберите эти объекты из заявки или добавьте к ним генотипы и выполните поиск.']
};
function problem(profile, code, issue) {
  const [message, instruction] = problemReasons[code] || [issue.message, 'Исправьте указанное поле в «Моих генотипах».'];
  return {
    code, message, instruction, profileId: profile.id,
    objectNumber: profile.internal_number, year: profile.year, expertiseType: profile.expertise_type
  };
}
function approvalError(message, code, problems) {
  return err(message, 409, code, { groups: groupApprovalProblems(problems) });
}
function runProblem(run, workspace, refs) {
  if (!run) return 'NO_SEARCH';
  if (run.state !== 'complete' || !run.completed_at || run.mode !== 'FULL_SEARCH') return 'SEARCH_INCOMPLETE';
  if (run.algorithm_version !== ALGORITHM_VERSION) return 'ALGORITHM_CHANGED';
  if (run.workspace_revision !== workspace.analysis_revision) return 'WORKSPACE_CHANGED';
  if (run.master_revision !== refs.master_revision) return 'MASTER_CHANGED';
  if (run.staff_revision !== refs.staff_revision) return 'STAFF_CHANGED';
  return null;
}
const targetFingerprint = p => p ? hash({ id:p.id, source:p.source_workspace_profile_id, year:p.year, type:p.expertise_type,
  number:p.internal_number, active:p.is_active, genotype:p.str_data, encryptedGenotype:p.str_data_encrypted, comment:p.comment, metadata:p.metadata }) : null;

class WorkspaceApprovalService extends WorkspaceSearchService {
  async approver(user, c = this.pool, lock = false) {
    requireUser(user);
    const actor = (await c.query(`SELECT id,organization_id,can_approve_master,is_active FROM users WHERE id=$1 ${lock ? 'FOR SHARE' : ''}`, [user.id])).rows[0];
    if (!actor?.is_active || actor.organization_id !== user.organization_id || actor.can_approve_master !== true) throw err('Нет права окончательного подтверждения мастер-массива.',403,'MASTER_APPROVAL_FORBIDDEN');
    return actor;
  }
  async checkReadiness(c, w, profiles, run, refs, { explainMissingRun = false } = {}) {
    const ids = profiles.map(p => p.id);
    let evidence = [];
    if (run) {
      evidence = (await c.query('SELECT * FROM workspace_search_profiles WHERE search_run_id=$1 AND profile_id=ANY($2::uuid[])', [run.id, ids])).rows;
    } else if (explainMissingRun) {
      evidence = (await c.query(`SELECT DISTINCT ON (sp.profile_id) sp.*, r.state AS run_state,
          r.completed_at, r.mode, r.algorithm_version, r.workspace_revision, r.master_revision, r.staff_revision
        FROM workspace_search_profiles sp JOIN workspace_search_runs r ON r.id=sp.search_run_id
        WHERE r.workspace_id=$1 AND r.owner_id=$2 AND r.organization_id=$3 AND sp.profile_id=ANY($4::uuid[])
        ORDER BY sp.profile_id, (r.state='complete' AND r.completed_at IS NOT NULL AND r.algorithm_version=$5
          AND r.workspace_revision=$6 AND r.master_revision=$7 AND r.staff_revision=$8) DESC, r.started_at DESC, r.id DESC`,
      [w.id, w.owner_id, w.organization_id, ids, ALGORITHM_VERSION, w.analysis_revision, refs.master_revision, refs.staff_revision])).rows;
    }
    const proofByProfile = new Map(evidence.map(proof => [proof.profile_id, proof]));
    const problems = [];
    for (const p of profiles) {
      const row = objectFromDB(p);
      if (!p.is_active) { problems.push(problem(p, 'REMOVED')); continue; }
      if (!['chs', 'ug', 'gr'].includes(p.expertise_type)) { problems.push(problem(p, 'STAFF')); continue; }
      const issues = validateObject(row);
      if (issues.length) { problems.push(...issues.map(issue => problem(p, issue.code, issue))); continue; }

      const proof = proofByProfile.get(p.id);
      const scopeMatches = !run || run.workspace_id === w.id && run.owner_id === w.owner_id && run.organization_id === w.organization_id;
      const evidenceRun = run || (proof && { ...proof, state: proof.run_state });
      const stale = scopeMatches ? runProblem(evidenceRun, w, refs) : 'NO_SEARCH';
      if (stale) { problems.push(problem(p, stale)); continue; }
      if (!proof) { problems.push(problem(p, 'NO_SEARCH')); continue; }
      if (proof.analysis_revision !== p.analysis_revision || proof.analysis_hash !== analysisHash(row)) {
        problems.push(problem(p, 'PROFILE_CHANGED')); continue;
      }
      if (!isMasterApprovalProof(proof.state, proof.stages, hasGenotype(p.str_data))) {
        problems.push(problem(p, 'SEARCH_INCOMPLETE')); continue;
      }
      if (!run) problems.push(problem(p, 'SEPARATE_RUNS'));
    }
    return { problems, proofByProfile };
  }

  async matchingRun(c, w, profiles, refs, searchRunId) {
    const columns = 'r.id,r.workspace_id,r.owner_id,r.organization_id,r.state,r.completed_at,r.mode,r.algorithm_version,r.workspace_revision,r.master_revision,r.staff_revision';
    const scope = [w.id, w.owner_id, w.organization_id];
    if (searchRunId) return (await c.query(`SELECT ${columns} FROM workspace_search_runs r WHERE r.workspace_id=$1 AND r.owner_id=$2 AND r.organization_id=$3 AND r.id=$4`, [...scope, searchRunId])).rows[0];
    return (await c.query(`SELECT ${columns} FROM workspace_search_runs r WHERE r.workspace_id=$1 AND r.owner_id=$2 AND r.organization_id=$3
      AND r.state='complete' AND r.completed_at IS NOT NULL AND r.algorithm_version=$4 AND r.workspace_revision=$5 AND r.master_revision=$6 AND r.staff_revision=$7
      AND (SELECT count(*) FROM workspace_search_profiles sp WHERE sp.search_run_id=r.id AND sp.profile_id=ANY($8::uuid[]))=$9
      ORDER BY r.completed_at DESC,r.id LIMIT 1`,
    [...scope, ALGORITHM_VERSION, w.analysis_revision, refs.master_revision, refs.staff_revision, profiles.map(p => p.id), profiles.length])).rows[0];
  }

  async masterTargets(c, organizationId, profiles) {
    const { rows } = await c.query(`SELECT p.id AS selected_profile_id, target.*,
        (target.str_data_encrypted IS NULL AND workspace_empty_master_genotype(target.str_data)) AS target_without_genotype
      FROM dna_profiles p JOIN master_array_profiles target ON target.organization_id=p.organization_id
        AND target.year=p.year AND target.expertise_type=p.expertise_type
        AND lower(btrim(target.internal_number))=lower(btrim(p.internal_number)) AND target.is_active=true
      WHERE p.organization_id=$1 AND p.id=ANY($2::uuid[])
      ORDER BY p.id,target.id`, [organizationId, profiles.map(p => p.id)]);
    const byProfile = new Map();
    for (const row of rows) {
      if (!byProfile.has(row.selected_profile_id)) byProfile.set(row.selected_profile_id, []);
      byProfile.get(row.selected_profile_id).push(row);
    }
    return byProfile;
  }

  async resolveTargets(c, user, profiles, existingTargets = {}) {
    const ids = new Set(profiles.map(p => p.id));
    if (Object.keys(existingTargets).some(id => !ids.has(id))) throw err('Сопоставление содержит объект вне выбора.');
    const byProfile = await this.masterTargets(c, user.organization_id, profiles);
    const resolved = [], conflicts = [], problems = [];
    for (const p of profiles) {
      const targets = byProfile.get(p.id) || [];
      const target = existingTargets[p.id] ? targets.find(t => t.id === existingTargets[p.id]) : targets.find(t => t.source_workspace_profile_id === p.id);
      if (existingTargets[p.id] && !target) throw err('Сопоставленная мастер-запись изменилась. Откройте заявку заново.', 409, 'BUSINESS_CONFLICT');
      if (!hasGenotype(p.str_data) && targets.some(t => !t.target_without_genotype)) {
        problems.push(problem(p, 'EMPTY_REPLACEMENT'));
        continue;
      }
      if (targets.length && (!target || targets.some(t => t.id !== target.id))) {
        for (const t of targets) conflicts.push({ profileId: p.id, objectNumber: p.internal_number, year: p.year, expertiseType: p.expertise_type, publishedId: t.id });
        continue;
      }
      resolved.push({ profile: p, targetId: target?.id || randomUUID(), targetFingerprint: targetFingerprint(target), replaceExisting: !!target });
    }
    return { resolved, conflicts, problems };
  }

  async pendingProblems(c, profiles) {
    const { rows } = await c.query('SELECT profile_id FROM workspace_master_approval_pending WHERE profile_id=ANY($1::uuid[])', [profiles.map(p => p.id)]);
    const pending = new Set(rows.map(row => row.profile_id));
    return profiles.filter(p => pending.has(p.id)).map(p => problem(p, 'PENDING'));
  }

  async approvalPreview(user, ids, existingTargets = {}) {
    requireUser(user, true);
    return this.transaction(async c => {
      const w = await this.workspace(user, c, true), profiles = await this.ownProfiles(c, user, w, ids, true);
      const refs = (await c.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1 FOR SHARE', [user.organization_id])).rows[0];
      const run = await this.matchingRun(c, w, profiles, refs);
      const { problems, proofByProfile } = await this.checkReadiness(c, w, profiles, run, refs, { explainMissingRun: true });
      problems.push(...await this.pendingProblems(c, profiles));
      const targets = await this.resolveTargets(c, user, profiles, existingTargets);
      problems.push(...targets.problems);
      if (problems.length) {
        const needsSearch = problems.some(p => p.instruction === searchInstruction);
        throw approvalError('Часть выбранных объектов пока нельзя отправить.', needsSearch ? 'FULL_SEARCH_REQUIRED' : 'APPROVAL_BLOCKED', problems);
      }
      if (targets.conflicts.length) return { conflicts: targets.conflicts };
      return {
        searchRunId: run.id,
        analysisCompletedAt: run.completed_at,
        profiles: targets.resolved.map(({ profile: p, targetId, replaceExisting }) => ({
          id: p.id, objectNumber: p.internal_number, year: p.year, expertiseType: p.expertise_type,
          withoutGenotype: !hasGenotype(p.str_data), belowSearchThreshold: proofByProfile.get(p.id)?.state === 'INSUFFICIENT_DATA',
          targetId, replaceExisting
        })),
        count: profiles.length
      };
    });
  }

  async submitApproval(user,ids,searchRunId,existingTargets={},idempotencyKey) {
    requireUser(user,true);
    const submissionHash=hash({ids:[...ids].sort(),searchRunId,existingTargets});
    return this.transaction(async c=>{
      const w=await this.workspace(user,c,true);
      const replay=(await c.query('SELECT * FROM workspace_master_approvals WHERE author_id=$1 AND submission_key=$2',[user.id,idempotencyKey])).rows[0];
      if(replay) {
        if(replay.submission_hash!==submissionHash || replay.organization_id!==user.organization_id) throw err('Ключ повтора уже использован для другого выбора.',409);
        return {id:replay.id,state:replay.state,replayed:true};
      }
      const profiles=await this.ownProfiles(c,user,w,ids,true);
      const refs=(await c.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1 FOR SHARE',[user.organization_id])).rows[0];
      const run = await this.matchingRun(c, w, profiles, refs, searchRunId);
      const { problems } = await this.checkReadiness(c, w, profiles, run, refs);
      if (problems.length) throw approvalError('Для заявки нужен актуальный полный поиск по выбранным объектам.', 'FULL_SEARCH_REQUIRED', problems);
      const occupied = await this.pendingProblems(c, profiles);
      if (occupied.length) throw approvalError('Часть объектов уже на подтверждении.', 'APPROVAL_PENDING', occupied);
      const { resolved, conflicts, problems: targetProblems } = await this.resolveTargets(c, user, profiles, existingTargets);
      if (targetProblems.length) throw approvalError('Сопоставление записей недоступно.', 'APPROVAL_BLOCKED', targetProblems);
      if (conflicts.length) {
        const conflictIds = new Set(conflicts.map(conflict => conflict.profileId));
        throw approvalError('В мастер-массиве уже есть объекты из этой заявки.', 'BUSINESS_CONFLICT',
          profiles.filter(p => conflictIds.has(p.id)).map(p => problem(p, 'TARGET_CONFLICT')));
      }
      const id = randomUUID();
      await c.query(`INSERT INTO workspace_master_approvals(id,organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash,encrypted_submission) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,user.organization_id,w.id,user.id,run.id,idempotencyKey,submissionHash,seal({profiles:profiles.map(objectFromDB),searchRunId:run.id,analysisCompletedAt:run.completed_at})]);
      const items = resolved.map(({ profile: p, targetId, targetFingerprint, replaceExisting }) => ({
        profile_id: p.id, analysis_revision: p.analysis_revision, analysis_hash: analysisHash(objectFromDB(p)),
        target_id: targetId, target_fingerprint: targetFingerprint, replace_existing: replaceExisting
      }));
      await c.query(`INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,target_fingerprint,replace_existing)
        SELECT $1,$2,i.profile_id,i.analysis_revision,i.analysis_hash,i.target_id,i.target_fingerprint,i.replace_existing
        FROM jsonb_to_recordset($3::jsonb) i(profile_id uuid,analysis_revision bigint,analysis_hash text,target_id uuid,target_fingerprint text,replace_existing boolean)`, [id, run.id, JSON.stringify(items)]);
      await c.query('INSERT INTO workspace_master_approval_pending(profile_id,approval_id) SELECT profile_id,approval_id FROM workspace_master_approval_items WHERE approval_id=$1',[id]);
      return {id,state:'pending',count:profiles.length,analysisCompletedAt:run.completed_at};
    });
  }
  async approvalList(user) {
    await this.approver(user);
    return {requests:(await this.pool.query(`SELECT a.id,a.state,a.submitted_at,a.decided_at,a.decision_comment,a.author_id,
      COALESCE(NULLIF(u.display_name,''),u.username) author_name,CASE WHEN r.state='complete' AND r.completed_at IS NOT NULL THEN r.completed_at END analysis_completed_at,count(i.profile_id)::int profile_count
      FROM workspace_master_approvals a JOIN users u ON u.id=a.author_id JOIN workspace_search_runs r ON r.id=a.search_run_id
      JOIN workspace_master_approval_items i ON i.approval_id=a.id WHERE a.organization_id=$1 AND a.author_id<>$2 AND a.state='pending'
      GROUP BY a.id,u.id,r.id ORDER BY a.submitted_at,a.id`,[user.organization_id,user.id])).rows};
  }
  async ownApprovalHistory(user) {
    requireUser(user);
    return {requests:(await this.pool.query(`SELECT a.id,CASE WHEN undo.approval_id IS NOT NULL THEN 'rolled_back' ELSE a.state END state,a.submitted_at,a.decided_at,a.decision_comment,
      COALESCE(NULLIF(d.display_name,''),d.username) decider_name,CASE WHEN r.state='complete' AND r.completed_at IS NOT NULL THEN r.completed_at END analysis_completed_at,count(i.profile_id)::int profile_count
      FROM workspace_master_approvals a JOIN workspace_search_runs r ON r.id=a.search_run_id
      LEFT JOIN users d ON d.id=a.decided_by LEFT JOIN workspace_master_rollbacks undo ON undo.approval_id=a.id JOIN workspace_master_approval_items i ON i.approval_id=a.id
      WHERE a.author_id=$1 AND a.organization_id=$2 GROUP BY a.id,d.id,r.id,undo.approval_id ORDER BY a.submitted_at DESC,a.id LIMIT 200`,[user.id,user.organization_id])).rows};
  }
  async requestRow(c,user,id,lock=false) {
    const a=(await c.query(`SELECT a.*,COALESCE(NULLIF(u.display_name,''),u.username) author_name,COALESCE(NULLIF(d.display_name,''),d.username) decider_name,CASE WHEN r.state='complete' AND r.completed_at IS NOT NULL THEN r.completed_at END analysis_completed_at
      FROM workspace_master_approvals a JOIN users u ON u.id=a.author_id LEFT JOIN users d ON d.id=a.decided_by JOIN workspace_search_runs r ON r.id=a.search_run_id
      WHERE a.id=$1 AND a.organization_id=$2 ${lock?'FOR UPDATE OF a':''}`,[id,user.organization_id])).rows[0];
    if(!a) throw err('Заявка недоступна.',404);
    return a;
  }
  async approvalSnapshot(c,user,a,lock=false) {
    const w=(await c.query(`SELECT * FROM personal_workspaces WHERE id=$1 AND organization_id=$2 ${lock?'FOR UPDATE':''}`,[a.workspace_id,user.organization_id])).rows[0];
    const items=(await c.query('SELECT * FROM workspace_master_approval_items WHERE approval_id=$1 ORDER BY profile_id',[a.id])).rows;
    // Only the saved selection is exposed; never query the author's other private profiles.
    const profiles=(await c.query(`SELECT * FROM dna_profiles WHERE id=ANY($1::uuid[]) AND workspace_id=$2 AND user_id=$3 AND organization_id=$4 ORDER BY id ${lock?'FOR UPDATE':''}`,[items.map(i=>i.profile_id),a.workspace_id,a.author_id,user.organization_id])).rows;
    const refs=(await c.query(`SELECT * FROM workspace_reference_versions WHERE organization_id=$1 ${lock?'FOR UPDATE':''}`,[user.organization_id])).rows[0];
    const run=(await c.query('SELECT * FROM workspace_search_runs WHERE id=$1',[a.search_run_id])).rows[0];
    const { problems, proofByProfile } = await this.checkReadiness(c, w, profiles, run, refs);
    for (const issue of problems) {
      if (issue.instruction === searchInstruction) issue.instruction = 'После возврата заявки автору нужно выполнить новый полный поиск и отправить заявку повторно.';
    }
    const profileById = new Map(profiles.map(p => [p.id, p]));
    const itemsByProfile = new Map(items.map(item => [item.profile_id, item]));
    const targets=(await c.query(`SELECT * FROM master_array_profiles WHERE id=ANY($1::uuid[]) AND organization_id=$2 ORDER BY id ${lock?'FOR UPDATE':''}`,[items.map(i=>i.target_id),user.organization_id])).rows;
    const targetById = new Map(targets.map(p => [p.id, p]));
    for (const item of items) {
      const p = profileById.get(item.profile_id);
      if (!p || p.analysis_revision !== item.analysis_revision || analysisHash(objectFromDB(p)) !== item.analysis_hash) {
        problems.push(problem(p || { id: item.profile_id }, 'REQUEST_CHANGED'));
      }
      if (targetFingerprint(targetById.get(item.target_id)) !== item.target_fingerprint) {
        problems.push(problem(p || { id: item.profile_id }, 'TARGET_CHANGED'));
      }
    }
    const result=run?.encrypted_result ? unseal(run.encrypted_result) : {};
    const chosen=new Set(items.map(i=>i.profile_id));
    const matches={internal:(result.internal?.results||[]).filter(g=>chosen.has(g.reference.id)),master:(result.master?.results||[]).filter(g=>chosen.has(g.reference.id)),staff:(result.staff||[]).filter(g=>chosen.has(g.profileId))};
    // Internal matches can contain another private profile. Expose only comparison evidence, no genotype or unrelated identifiers.
    matches.internal=matches.internal.map(g=>({reference:{id:g.reference.id},matches:(g.exportMatches||g.matches).map(m=>({matchCount:m.matchCount,matchedLoci:m.matchedLoci,algorithm:m.algorithm}))}));
    const token=hash({id:a.id,state:a.state,profiles:profiles.map(objectFromDB),items,targets:targets.map(p=>({id:p.id,fingerprint:targetFingerprint(p)})),problems});
    return {id:a.id,state:a.state,authorId:a.author_id,authorName:a.author_name,deciderName:a.decider_name,submittedAt:a.submitted_at,decidedAt:a.decided_at,decisionComment:a.decision_comment,
      searchRunId:a.search_run_id,analysisCompletedAt:a.analysis_completed_at,reviewToken:token,requiresSearch:problems.length>0,problems,
      profiles: profiles.map(p => {
        const item = itemsByProfile.get(p.id);
        return {
          ...objectFromDB(p), isActive: p.is_active, withoutGenotype: !hasGenotype(p.str_data),
          belowSearchThreshold: proofByProfile.get(p.id)?.state === 'INSUFFICIENT_DATA',
          targetId: item.target_id, replaceExisting: item.replace_existing
        };
      }), matches,
      _items: items, _profiles: profiles};
  }
  async approvalDetail(user,id) {
    requireUser(user);
    const a=await this.requestRow(this.pool,user,id);
    if(a.author_id!==user.id) await this.approver(user);
    return this.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const current=await this.requestRow(c,user,id);
      if (current.state !== 'pending' && current.encrypted_decision) {
        const { rows: [rollback] } = await c.query(`SELECT undo.reason,undo.rolled_back_at AS "rolledBackAt",
            COALESCE(NULLIF(u.display_name,''),u.username) AS "rolledBackBy"
          FROM workspace_master_rollbacks undo JOIN users u ON u.id=undo.rolled_back_by WHERE undo.approval_id=$1`, [id]);
        return { ...unseal(current.encrypted_decision), state: rollback ? 'rolled_back' : current.state,
          deciderName: current.decider_name, decidedAt: current.decided_at, decisionComment: current.decision_comment, rollback };
      }
      const detail=await this.approvalSnapshot(c,user,current);
      return this.publicSnapshot(detail);
    });
  }
  publicSnapshot({_items,_profiles,...detail}) {return detail;}
  async decideApproval(user,id,decision,reviewToken,comment='') {
    return this.transaction(async c=>{
      await this.approver(user,c,true); // Locks permission against concurrent revocation until this transaction ends.
      const header=await this.requestRow(c,user,id);
      if(header.author_id===user.id) throw err('Свою заявку подтверждать или возвращать нельзя.',403,'SELF_APPROVAL_FORBIDDEN');
      // All source mutations lock workspace before profile rows; keep the same order.
      await c.query('SELECT id FROM personal_workspaces WHERE id=$1 FOR UPDATE',[header.workspace_id]);
      const a=await this.requestRow(c,user,id,true);
      if(a.state!=='pending') return {id:a.id,state:a.state,decidedBy:a.decided_by,decidedAt:a.decided_at,replayed:true};
      const detail=await this.approvalSnapshot(c,user,a,true);
      if(detail.reviewToken!==reviewToken) throw err('Данные окна изменились. Откройте заявку заново и проверьте актуальный текст и результаты.',409,'REVIEW_STALE');
      if(decision==='approve' && detail.problems.length) throw approvalError('Часть объектов больше нельзя подтвердить.', 'FULL_SEARCH_REQUIRED', detail.problems);
      const state=decision==='approve'?'approved':'returned';
      await c.query('UPDATE workspace_master_approvals SET state=$1,decided_by=$2,decided_at=now(),decision_comment=$3,encrypted_decision=$5 WHERE id=$4',[state,user.id,comment,id,seal(this.publicSnapshot(detail))]);
      if(state==='approved') {
        const array=(await c.query(`INSERT INTO master_arrays(organization_id,organization_default,name,description) VALUES($1,true,'Общий мастер-массив','Согласованные профили организации') ON CONFLICT(organization_id) WHERE organization_default=true DO UPDATE SET organization_default=true RETURNING id,is_active`,[user.organization_id])).rows[0];
        if(!array.is_active) throw err('Общий массив выключен.',409);
        const currentTargets = await this.masterTargets(c, user.organization_id, detail._profiles);
        const itemById = new Map(detail._items.map(item => [item.profile_id, item]));
        const conflicts = detail._profiles.filter(p => (currentTargets.get(p.id) || []).some(target => target.id !== itemById.get(p.id).target_id));
        if (conflicts.length) throw approvalError('Появились другие записи с теми же номерами.', 'BUSINESS_CONFLICT', conflicts.map(p => problem(p, 'TARGET_CHANGED')));

        await c.query(`INSERT INTO workspace_publications(workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by,master_approval_id)
          SELECT profile_id,analysis_revision,$2,search_run_id,'master',target_id,$3,approval_id
          FROM workspace_master_approval_items WHERE approval_id=$1`, [id, user.organization_id, user.id]);
        await c.query(`UPDATE workspace_master_approval_items i SET publication_id=pub.id
          FROM workspace_publications pub WHERE i.approval_id=$1 AND pub.master_approval_id=i.approval_id
            AND pub.workspace_profile_id=i.profile_id`, [id]);
        await c.query(`INSERT INTO workspace_master_publication_versions(publication_id,previous_record)
          SELECT i.publication_id,to_jsonb(m)
          FROM workspace_master_approval_items i LEFT JOIN master_array_profiles m
            ON i.replace_existing AND m.id=i.target_id AND m.organization_id=$2
          WHERE i.approval_id=$1`, [id, user.organization_id]);
        await c.query("SELECT set_config('app.workspace_master_approval_id',$1,true)", [id]);
        const updated = await c.query(`UPDATE master_array_profiles target SET source_workspace_profile_id=p.id,
            internal_number=p.internal_number,sample_name=p.sample_name,year=p.year,expertise_type=p.expertise_type,
            comment=p.comment,str_data=p.str_data,metadata=jsonb_build_object('importFormat','genetic','provenance',p.provenance),
            str_data_encrypted=NULL,sample_name_encrypted=NULL,metadata_encrypted=NULL
          FROM workspace_master_approval_items i JOIN dna_profiles p ON p.id=i.profile_id
          WHERE i.approval_id=$1 AND i.replace_existing AND target.id=i.target_id AND target.organization_id=$2`, [id, user.organization_id]);
        if (updated.rowCount !== detail._items.filter(i => i.replace_existing).length) throw err('Целевая запись недоступна.', 409);
        await c.query(`INSERT INTO master_array_profiles(id,master_array_id,source_workspace_profile_id,internal_number,sample_name,year,expertise_type,comment,str_data,metadata,created_by,organization_id)
          SELECT i.target_id,$2,p.id,p.internal_number,p.sample_name,p.year,p.expertise_type,p.comment,p.str_data,
            jsonb_build_object('importFormat','genetic','provenance',p.provenance),$3,$4
          FROM workspace_master_approval_items i JOIN dna_profiles p ON p.id=i.profile_id
          WHERE i.approval_id=$1 AND NOT i.replace_existing
          ORDER BY i.profile_id`, [id, array.id, user.id, user.organization_id]);
        await c.query(`UPDATE workspace_master_publication_versions v SET applied_hash=workspace_master_row_hash(to_jsonb(m))
          FROM workspace_master_approval_items i JOIN master_array_profiles m ON m.id=i.target_id
          WHERE i.approval_id=$1 AND m.organization_id=$2 AND v.publication_id=i.publication_id`, [id, user.organization_id]);
      }
      await c.query('DELETE FROM workspace_master_approval_pending WHERE approval_id=$1',[id]);
      return {id,state,count:detail.profiles.length};
    });
  }
}
module.exports={WorkspaceApprovalService};

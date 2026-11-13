const { randomUUID } = require('node:crypto');
const { WorkspaceSearchService, ALGORITHM_VERSION } = require('./workspaceSearchService');
const { requireUser, objectFromDB, err } = require('./workspaceService');
const { analysisHash, hash, validateObject, hasGenotype } = require('../../utils/objectImportV2');
const { seal, unseal } = require('./workspaceCrypto');
const stagesOK = stages => stages?.internal === true && stages?.master === true && stages?.staff === true;
const targetFingerprint = p => p ? hash({ id:p.id, source:p.source_workspace_profile_id, year:p.year, type:p.expertise_type,
  number:p.internal_number, active:p.is_active, genotype:p.str_data, encryptedGenotype:p.str_data_encrypted, comment:p.comment, metadata:p.metadata }) : null;

class WorkspaceApprovalService extends WorkspaceSearchService {
  async approver(user, c = this.pool, lock = false) {
    requireUser(user);
    const actor = (await c.query(`SELECT id,organization_id,can_approve_master,is_active FROM users WHERE id=$1 ${lock ? 'FOR SHARE' : ''}`, [user.id])).rows[0];
    if (!actor?.is_active || actor.organization_id !== user.organization_id || actor.can_approve_master !== true) throw err('Нет права окончательного подтверждения мастер-массива.',403,'MASTER_APPROVAL_FORBIDDEN');
    return actor;
  }
  async checkReadiness(c, w, profiles, run, refs) {
    const proofs = run ? (await c.query('SELECT * FROM workspace_search_profiles WHERE search_run_id=$1 AND profile_id=ANY($2::uuid[])', [run.id,profiles.map(p=>p.id)])).rows : [];
    const validRun = run && run.state === 'complete' && run.completed_at && run.mode === 'FULL_SEARCH' && run.workspace_id === w.id && run.owner_id === w.owner_id && run.organization_id === w.organization_id && run.algorithm_version === ALGORITHM_VERSION && run.workspace_revision === w.analysis_revision && run.master_revision === refs.master_revision && run.staff_revision === refs.staff_revision;
    return profiles.flatMap(p => {
      const proof = proofs.find(x=>x.profile_id===p.id);
      let reason;
      if (!p.is_active) reason='Объект удалён из личного массива.';
      else if (!['chs','ug','gr'].includes(p.expertise_type)) reason='Эталон сотрудника имеет отдельное назначение и административные права.';
      else if (!hasGenotype(p.str_data)) reason='Нет генотипа.';
      else if (!validRun) reason='Требуется повторный поиск: изменены данные, параметры или эталонный набор либо поиск не завершён успешно.';
      else if (!proof || proof.state!=='CHECKED' || !stagesOK(proof.stages) || proof.analysis_revision!==p.analysis_revision || proof.analysis_hash!==analysisHash(objectFromDB(p))) reason='Требуется полный поиск текущей версии по всем трём этапам.';
      else if (validateObject(objectFromDB(p)).length) reason='Исправьте метаданные объекта.';
      return reason ? [{profileId:p.id,objectNumber:p.internal_number,message:`${p.internal_number} (${p.year}): ${reason}`}] : [];
    });
  }
  async matchingRun(c,w,profiles,refs,searchRunId) {
    if (searchRunId) return (await c.query('SELECT * FROM workspace_search_runs WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND organization_id=$4',[searchRunId,w.id,w.owner_id,w.organization_id])).rows[0];
    return (await c.query(`SELECT r.* FROM workspace_search_runs r WHERE r.workspace_id=$1 AND r.owner_id=$2 AND r.organization_id=$3
      AND r.state='complete' AND r.completed_at IS NOT NULL AND r.algorithm_version=$4 AND r.workspace_revision=$5 AND r.master_revision=$6 AND r.staff_revision=$7
      AND (SELECT count(*) FROM workspace_search_profiles sp WHERE sp.search_run_id=r.id AND sp.profile_id=ANY($8::uuid[]) AND sp.state='CHECKED' AND sp.stages='{"internal":true,"master":true,"staff":true}'::jsonb)=$9
      ORDER BY r.completed_at DESC,r.id LIMIT 1`,[w.id,w.owner_id,w.organization_id,ALGORITHM_VERSION,w.analysis_revision,refs.master_revision,refs.staff_revision,profiles.map(p=>p.id),profiles.length])).rows[0];
  }
  async resolveTargets(c,user,profiles,existingTargets={}) {
    if (Object.keys(existingTargets).some(id=>!profiles.some(p=>p.id===id))) throw err('Сопоставление содержит объект вне выбора.');
    const result=[];
    for (const p of profiles) {
      const targets=(await c.query(`SELECT * FROM master_array_profiles WHERE organization_id=$1 AND year=$2 AND expertise_type=$3 AND lower(btrim(internal_number))=lower(btrim($4)) AND is_active=true ORDER BY id`,[user.organization_id,p.year,p.expertise_type,p.internal_number])).rows;
      const linked=targets.find(target=>target.source_workspace_profile_id===p.id);
      const target=existingTargets[p.id] ? targets.find(target=>target.id===existingTargets[p.id]) : linked;
      if (existingTargets[p.id] && !target) throw err('Сопоставленная мастер-запись не соответствует объекту.',403);
      if (targets.length && (!target || targets.some(t=>t.id!==target.id))) throw err('В мастер-массиве уже есть объект. Подтвердите сопоставление перед отправкой.',409,'BUSINESS_CONFLICT',[{objectNumber:p.internal_number,message:`Сопоставьте ${p.internal_number} (${p.year}) с существующей мастер-записью.`}]);
      result.push({profile:p,targetId:target?.id||randomUUID(),targetFingerprint:targetFingerprint(target),replaceExisting:!!target});
    }
    return result;
  }
  async approvalPreview(user,ids,existingTargets={}) {
    requireUser(user,true);
    return this.transaction(async c=>{
      const w=await this.workspace(user,c,true), profiles=await this.ownProfiles(c,user,w,ids,true);
      const refs=(await c.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1 FOR SHARE',[user.organization_id])).rows[0];
      const run=await this.matchingRun(c,w,profiles,refs);
      const problems=await this.checkReadiness(c,w,profiles,run,refs);
      const pending=(await c.query('SELECT profile_id FROM workspace_master_approval_pending WHERE profile_id=ANY($1::uuid[])',[ids])).rows;
      for(const slot of pending) problems.push({profileId:slot.profile_id,message:`${profiles.find(p=>p.id===slot.profile_id)?.internal_number}: уже на подтверждении.`});
      if(problems.length) throw err('Выбранные строки нельзя отправить одной заявкой. Выполните полный поиск по выбору или отправьте группы отдельно.',409,'FULL_SEARCH_REQUIRED',problems);
      const targets=await this.resolveTargets(c,user,profiles,existingTargets);
      return {searchRunId:run.id,analysisCompletedAt:run.completed_at,profiles:targets.map(t=>({...objectFromDB(t.profile),targetId:t.targetId,replaceExisting:t.replaceExisting})),count:profiles.length};
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
      const run=await this.matchingRun(c,w,profiles,refs,searchRunId), problems=await this.checkReadiness(c,w,profiles,run,refs);
      if(problems.length) throw err('Требуется повторный поиск выбранных объектов.',409,'FULL_SEARCH_REQUIRED',problems);
      const occupied=(await c.query('SELECT profile_id FROM workspace_master_approval_pending WHERE profile_id=ANY($1::uuid[])',[ids])).rows;
      if(occupied.length) throw err('Часть объектов уже на подтверждении.',409,'APPROVAL_PENDING');
      const targets=await this.resolveTargets(c,user,profiles,existingTargets), id=randomUUID();
      await c.query(`INSERT INTO workspace_master_approvals(id,organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash,encrypted_submission) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,user.organization_id,w.id,user.id,run.id,idempotencyKey,submissionHash,seal({profiles:profiles.map(objectFromDB),searchRunId:run.id,analysisCompletedAt:run.completed_at})]);
      for(const t of targets) await c.query(`INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,target_fingerprint,replace_existing) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,run.id,t.profile.id,t.profile.analysis_revision,analysisHash(objectFromDB(t.profile)),t.targetId,t.targetFingerprint,t.replaceExisting]);
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
    return {requests:(await this.pool.query(`SELECT a.id,a.state,a.submitted_at,a.decided_at,a.decision_comment,
      COALESCE(NULLIF(d.display_name,''),d.username) decider_name,CASE WHEN r.state='complete' AND r.completed_at IS NOT NULL THEN r.completed_at END analysis_completed_at,count(i.profile_id)::int profile_count
      FROM workspace_master_approvals a JOIN workspace_search_runs r ON r.id=a.search_run_id
      LEFT JOIN users d ON d.id=a.decided_by JOIN workspace_master_approval_items i ON i.approval_id=a.id
      WHERE a.author_id=$1 AND a.organization_id=$2 GROUP BY a.id,d.id,r.id ORDER BY a.submitted_at DESC,a.id LIMIT 200`,[user.id,user.organization_id])).rows};
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
    const problems=await this.checkReadiness(c,w,profiles,run,refs);
    for(const item of items) {
      const p=profiles.find(p=>p.id===item.profile_id);
      if(!p || p.analysis_revision!==item.analysis_revision || analysisHash(objectFromDB(p))!==item.analysis_hash) problems.push({profileId:item.profile_id,message:`${p?.internal_number||'Объект'}: версия заявки изменилась; требуется повторный поиск и новая отправка.`});
    }
    const targets=(await c.query(`SELECT * FROM master_array_profiles WHERE id=ANY($1::uuid[]) AND organization_id=$2 ORDER BY id ${lock?'FOR UPDATE':''}`,[items.map(i=>i.target_id),user.organization_id])).rows;
    for(const item of items) if(targetFingerprint(targets.find(p=>p.id===item.target_id))!==item.target_fingerprint) problems.push({profileId:item.profile_id,message:'Целевая мастер-запись изменилась. Требуется повторное сопоставление и отправка.'});
    const result=run?.encrypted_result ? unseal(run.encrypted_result) : {};
    const chosen=new Set(items.map(i=>i.profile_id));
    const matches={internal:(result.internal?.results||[]).filter(g=>chosen.has(g.reference.id)),master:(result.master?.results||[]).filter(g=>chosen.has(g.reference.id)),staff:(result.staff||[]).filter(g=>chosen.has(g.profileId))};
    // Internal matches can contain another private profile. Expose only comparison evidence, no genotype or unrelated identifiers.
    matches.internal=matches.internal.map(g=>({reference:{id:g.reference.id},matches:(g.exportMatches||g.matches).map(m=>({matchCount:m.matchCount,matchedLoci:m.matchedLoci,algorithm:m.algorithm}))}));
    const token=hash({id:a.id,state:a.state,profiles:profiles.map(objectFromDB),items,targets:targets.map(p=>({id:p.id,fingerprint:targetFingerprint(p)})),problems});
    return {id:a.id,state:a.state,authorId:a.author_id,authorName:a.author_name,deciderName:a.decider_name,submittedAt:a.submitted_at,decidedAt:a.decided_at,decisionComment:a.decision_comment,
      searchRunId:a.search_run_id,analysisCompletedAt:a.analysis_completed_at,reviewToken:token,requiresSearch:problems.length>0,problems,
      profiles:profiles.map(p=>({...objectFromDB(p),isActive:p.is_active,targetId:items.find(i=>i.profile_id===p.id).target_id,replaceExisting:items.find(i=>i.profile_id===p.id).replace_existing})),matches,
      _items:items,_profiles:profiles,_run:run};
  }
  async approvalDetail(user,id) {
    requireUser(user);
    const a=await this.requestRow(this.pool,user,id);
    if(a.author_id!==user.id) await this.approver(user);
    return this.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const current=await this.requestRow(c,user,id);
      if(current.state!=='pending' && current.encrypted_decision) return {...unseal(current.encrypted_decision),state:current.state,deciderName:current.decider_name,decidedAt:current.decided_at,decisionComment:current.decision_comment};
      const detail=await this.approvalSnapshot(c,user,current);
      return this.publicSnapshot(detail);
    });
  }
  publicSnapshot({_items,_profiles,_run,...detail}) {return detail;}
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
      if(decision==='approve' && detail.problems.length) throw err('Требуется повторный поиск и новая отправка.',409,'FULL_SEARCH_REQUIRED',detail.problems);
      const state=decision==='approve'?'approved':'returned';
      await c.query('UPDATE workspace_master_approvals SET state=$1,decided_by=$2,decided_at=now(),decision_comment=$3,encrypted_decision=$5 WHERE id=$4',[state,user.id,comment,id,seal(this.publicSnapshot(detail))]);
      if(state==='approved') {
        const array=(await c.query(`INSERT INTO master_arrays(organization_id,organization_default,name,description) VALUES($1,true,'Общий мастер-массив','Согласованные профили организации') ON CONFLICT(organization_id) WHERE organization_default=true DO UPDATE SET organization_default=true RETURNING id,is_active`,[user.organization_id])).rows[0];
        if(!array.is_active) throw err('Общий массив выключен.',409);
        for(const item of detail._items) {
          const p=detail._profiles.find(p=>p.id===item.profile_id);
          const conflicts=(await c.query('SELECT id FROM master_array_profiles WHERE organization_id=$1 AND year=$2 AND expertise_type=$3 AND lower(btrim(internal_number))=lower(btrim($4)) AND is_active=true AND id<>$5',[user.organization_id,p.year,p.expertise_type,p.internal_number,item.target_id])).rows;
          if(conflicts.length) throw err('Появилась другая целевая мастер-запись. Требуется повторное сопоставление.',409,'BUSINESS_CONFLICT');
          const publication=randomUUID();
          await c.query(`INSERT INTO workspace_publications(id,workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by,master_approval_id) VALUES($1,$2,$3,$4,$5,'master',$6,$7,$8)`,[publication,p.id,p.analysis_revision,user.organization_id,a.search_run_id,item.target_id,user.id,id]);
          await c.query('UPDATE workspace_master_approval_items SET publication_id=$1 WHERE approval_id=$2 AND profile_id=$3',[publication,id,p.id]);
          await c.query("SELECT set_config('app.workspace_publication_id',$1,true)",[publication]);
          const metadata=JSON.stringify({importFormat:'genetic',provenance:p.provenance});
          if(item.replace_existing) {
            const updated=await c.query(`UPDATE master_array_profiles SET source_workspace_profile_id=$1,internal_number=$2,sample_name=$3,year=$4,expertise_type=$5,comment=$6,str_data=$7,metadata=$8,str_data_encrypted=NULL,sample_name_encrypted=NULL,metadata_encrypted=NULL WHERE id=$9 AND organization_id=$10`,[p.id,p.internal_number,p.sample_name,p.year,p.expertise_type,p.comment,JSON.stringify(p.str_data),metadata,item.target_id,user.organization_id]);
            if(updated.rowCount!==1) throw err('Целевая запись недоступна.',409);
          } else await c.query(`INSERT INTO master_array_profiles(id,master_array_id,source_workspace_profile_id,internal_number,sample_name,year,expertise_type,comment,str_data,metadata,created_by,organization_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[item.target_id,array.id,p.id,p.internal_number,p.sample_name,p.year,p.expertise_type,p.comment,JSON.stringify(p.str_data),metadata,user.id,user.organization_id]);
        }
      }
      await c.query('DELETE FROM workspace_master_approval_pending WHERE approval_id=$1',[id]);
      return {id,state,count:detail.profiles.length};
    });
  }
}
module.exports={WorkspaceApprovalService};

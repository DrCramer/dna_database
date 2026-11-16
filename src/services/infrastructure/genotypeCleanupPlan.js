const {createHash}=require('node:crypto');
// Explicit data-only allowlist. No CASCADE: unexpected dependencies stop cleanup.
const TABLES={
 dna_profiles:'Личные и старые профили',master_array_profiles:'Профили мастер-массива',staff_profiles:'Эталоны сотрудников',
 workspace_import_drafts:'Черновики импорта',workspace_search_runs:'Поиски личных массивов',workspace_search_profiles:'Снимки проверенных профилей',
 workspace_search_jobs:'Задания ночного поиска',workspace_search_job_chunks:'Этапы ночного поиска',workspace_search_job_events:'События ночного поиска',
 workspace_publications:'Публикации генотипов',workspace_master_approvals:'Заявки на публикацию',workspace_master_approval_items:'Профили в заявках',workspace_master_approval_pending:'Ожидающие заявки',
 match_results:'Результаты сравнения',contamination_analysis:'Результаты контаминации',bayesian_analysis_results:'Результаты Bayesian',sample_quality_metrics:'Оценки качества',profile_contamination_log:'История совпадений',
 task_results:'Результаты задач',duplicate_group_comments:'Комментарии к группам дубликатов',probability_calculations:'Сохранённые расчёты вероятности'
};
const PRESERVED=['users','organizations','departments','tasks','user_settings','personal_workspaces','genotype_panels','allele_reference_sets','population_data','workspace_night_policies','master_arrays'];
// Search status/heartbeats change when workers stop. Invalidate confirmation on
// changes to source genotypes and imported/saved inputs, not job bookkeeping.
const INPUT_TABLES=new Set(['dna_profiles','master_array_profiles','staff_profiles','workspace_import_drafts','probability_calculations']);
const quote=table=>'public."'+table+'"';
async function tables(client){return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename",[Object.keys(TABLES)])).rows.map(r=>r.tablename);}
async function validateDependencies(client,list){const extra=(await client.query(`SELECT conrelid::regclass::text child FROM pg_constraint WHERE contype='f' AND confrelid=ANY($1::regclass[]) AND NOT conrelid=ANY($1::regclass[])`,[list.map(quote)])).rows;if(extra.length)throw Object.assign(Error('Обнаружены новые зависимости данных. Очистка отключена до проверки схемы.'),{status:409});}
async function snapshot(client,list){const rows=[];for(const table of list){const r=(await client.query(`SELECT count(*)::text count,coalesce(sum(hashtextextended(ctid::text||':'||xmin::text,0)::numeric),0)::text stamp FROM ${quote(table)}`)).rows[0];rows.push({table,label:TABLES[table],count:Number(r.count),stamp:r.stamp});}return {rows:rows.map(({stamp,...r})=>r),fingerprint:createHash('sha256').update(JSON.stringify(rows.filter(r=>INPUT_TABLES.has(r.table)))).digest('hex')};}
module.exports={TABLES,PRESERVED,quote,tables,validateDependencies,snapshot};

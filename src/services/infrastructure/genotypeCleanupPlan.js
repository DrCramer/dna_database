const { createHash } = require('node:crypto');

const CATEGORIES = {
  personal: 'Личные генотипы', master: 'Мастер-массив', staff: 'Профили сотрудников', results: 'Результаты поиска'
};
const TABLES = {
  dna_profiles: 'Личные и старые профили', master_array_profiles: 'Профили мастер-массива', staff_profiles: 'Эталоны сотрудников',
  workspace_import_drafts: 'Черновики импорта', workspace_search_runs: 'Поиски личных массивов', workspace_search_profiles: 'Снимки проверенных профилей',
  workspace_search_jobs: 'Задания ночного поиска', workspace_search_job_chunks: 'Этапы ночного поиска', workspace_search_job_events: 'События ночного поиска',
  workspace_publications: 'Связи публикаций с удаляемыми профилями', workspace_master_approvals: 'Заявки, зависящие от удаляемых профилей, и ожидающие заявки',
  workspace_master_approval_items: 'Объекты в сбрасываемых заявках', workspace_master_approval_pending: 'Ожидающие согласования',
  match_results: 'Результаты сравнения', contamination_analysis: 'Результаты контаминации', bayesian_analysis_results: 'Результаты Bayesian',
  sample_quality_metrics: 'Оценки качества', profile_contamination_log: 'История совпадений', task_results: 'Результаты задач', duplicate_group_comments: 'Комментарии к группам дубликатов'
};
const PRESERVED = ['users', 'organizations', 'departments', 'tasks', 'user_settings', 'personal_workspaces', 'genotype_panels', 'allele_reference_sets', 'population_data', 'workspace_night_policies', 'master_arrays', 'probability_calculations'];
const quote = table => 'public."' + table + '"';
const fail = message => Object.assign(Error(message), { status: 400 });
function categories(input) {
  if (!Array.isArray(input) || !input.length || input.length > 4 || new Set(input).size !== input.length || input.some(key => !Object.hasOwn(CATEGORIES, key))) {
    throw fail('Выберите хотя бы одну допустимую категорию очистки.');
  }
  return Object.keys(CATEGORIES).filter(key => input.includes(key));
}
async function tables(client) {
  return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename", [Object.keys(TABLES)])).rows.map(r => r.tablename);
}
async function validateDependencies(client, list) {
  const extra = (await client.query(`SELECT conrelid::regclass::text child FROM pg_constraint WHERE contype='f' AND confrelid=ANY($1::regclass[]) AND NOT conrelid=ANY($1::regclass[])`, [list.map(quote)])).rows;
  if (extra.length) throw Object.assign(Error('Обнаружены новые зависимости данных. Очистка отключена до проверки схемы.'), { status: 409 });
  const genotypeReferences = (await client.query(`SELECT c.relname child,p.relname parent,k.confdeltype,
    ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.n)::text[] columns,
    ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.n)::text[] parent_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid
    WHERE k.contype='f' AND k.confrelid=ANY($1::regclass[]) AND k.conrelid=ANY($2::regclass[])`,
    [list.map(quote), ['dna_profiles','master_array_profiles','staff_profiles'].filter(table => list.includes(table)).map(quote)])).rows;
  if (genotypeReferences.some(ref => !['master_array_profiles','staff_profiles'].includes(ref.child) || ref.parent !== 'dna_profiles'
    || JSON.stringify(ref.columns) !== '["source_workspace_profile_id"]' || JSON.stringify(ref.parent_columns) !== '["id"]' || !['a','r'].includes(ref.confdeltype))) {
    throw Object.assign(Error('Обнаружены новые связи генотипов. Выборочная очистка отключена до проверки схемы.'), { status: 409 });
  }
}

function operations(selection) {
  const selected = categories(selection), has = key => selected.includes(key);
  const types = [has('personal') && "'user'", has('master') && "'master'", has('staff') && "'staff'"].filter(Boolean);
  const dna = types.length ? `COALESCE(profile_type,'user') IN (${types.join(',')})` : 'false';
  const ids = `SELECT id FROM public.dna_profiles WHERE ${dna}`;
  const approvals = `SELECT a.id FROM public.workspace_master_approvals a WHERE a.state='pending' OR EXISTS
    (SELECT 1 FROM public.workspace_master_approval_items i WHERE i.approval_id=a.id AND i.profile_id IN (${ids}))`;
  const publications = `workspace_profile_id IN (${ids})${has('master') ? " OR destination='master'" : ''}${has('staff') ? " OR destination='staff'" : ''}`;
  const ops = [];
  const remove = (table, where = 'true', label = TABLES[table]) => ops.push({ table, where, label, action: 'delete', sql: `DELETE FROM ${quote(table)} WHERE ${where}` });
  const reset = (table, where, set, label) => ops.push({ table, where, label, action: 'reset', sql: `UPDATE ${quote(table)} SET ${set} WHERE ${where}` });
  for (const table of ['workspace_search_job_events', 'workspace_search_job_chunks', 'workspace_search_jobs']) remove(table);
  remove('workspace_master_approval_pending', `approval_id IN (${approvals})`);
  reset('workspace_master_approval_items', `approval_id NOT IN (${approvals}) AND publication_id IN (SELECT id FROM public.workspace_publications WHERE ${publications})`, 'publication_id=NULL', 'Связи заявок с удаляемыми публикациями');
  reset('workspace_publications', `NOT (${publications}) AND master_approval_id IN (${approvals})`, 'master_approval_id=NULL', 'Связи с удаляемыми заявками');
  remove('workspace_master_approval_items', `approval_id IN (${approvals})`);
  remove('workspace_publications', publications);
  remove('workspace_master_approvals', `id IN (${approvals})`);
  const keepProof = `EXISTS(SELECT 1 FROM public.workspace_master_approval_items i WHERE i.search_run_id=workspace_search_profiles.search_run_id AND i.profile_id=workspace_search_profiles.profile_id AND i.approval_id NOT IN (${approvals}))`;
  remove('workspace_search_profiles', `NOT (${keepProof})`);
  reset('workspace_search_profiles', `(${keepProof}) AND (state<>'PENDING' OR stages<>'{}'::jsonb)`, "state='PENDING',stages='{}'::jsonb", 'Сброс проверок, сохраняемых для истории согласований');
  const deleteRun = `NOT EXISTS(SELECT 1 FROM public.workspace_publications p WHERE p.search_run_id=workspace_search_runs.id AND NOT (${publications})) AND NOT EXISTS(SELECT 1 FROM public.workspace_master_approvals a WHERE a.search_run_id=workspace_search_runs.id AND a.id NOT IN (${approvals}))`;
  remove('workspace_search_runs', deleteRun);
  reset('workspace_search_runs', `NOT (${deleteRun}) AND (encrypted_result IS NOT NULL OR state<>'cancelled' OR error_code IS DISTINCT FROM 'ADMIN_RESULTS_CLEARED')`, "encrypted_result=NULL,state='cancelled',error_code='ADMIN_RESULTS_CLEARED'", 'Удаление результатов из поиска, сохраняемого для истории публикаций');
  for (const table of ['match_results', 'contamination_analysis', 'bayesian_analysis_results', 'sample_quality_metrics', 'profile_contamination_log', 'task_results', 'duplicate_group_comments']) remove(table);
  if (has('master')) remove('master_array_profiles');
  if (has('staff')) remove('staff_profiles');
  // Unselected published copies keep every genotype/metadata field; only the deleted-source link is cleared.
  for (const [key, table] of [['master', 'master_array_profiles'], ['staff', 'staff_profiles']]) if (!has(key) && types.length) {
    ops.push({ table, where: `source_workspace_profile_id IN (${ids})`, label: `Сохранение ${key === 'master' ? 'мастер-профилей' : 'профилей сотрудников'} без удаляемого исходника`, action: 'unlink',
      sql: `UPDATE ${quote(table)} SET source_workspace_profile_id=NULL WHERE source_workspace_profile_id IN (${ids})` });
  }
  if (types.length) remove('dna_profiles', dna, has('personal') && types.length === 1 ? 'Личные генотипы (включая старые задачи)' : 'Выбранные профили из личных и старых массивов');
  if (has('personal')) remove('workspace_import_drafts');
  return { selected, ops, approvals };
}

async function inspect(client, list, selection) {
  const spec = operations(selection), rows = [];
  for (const [index, op] of spec.ops.entries()) {
    if (!list.includes(op.table)) continue;
    const { count } = (await client.query(`SELECT count(*)::text count FROM ${quote(op.table)} WHERE ${op.where}`)).rows[0];
    rows.push({ key: String(index), table: op.table, label: op.label, action: op.action, count: Number(count) });
  }
  // Confirm all source inputs, including retained arrays: their changes can affect which copies must be detached.
  const stamps = [];
  for (const table of ['dna_profiles', 'master_array_profiles', 'staff_profiles', ...(spec.selected.includes('personal') ? ['workspace_import_drafts'] : [])]) {
    if (!list.includes(table)) continue;
    stamps.push({ table, ...(await client.query(`SELECT count(*)::text count,coalesce(sum(hashtextextended(ctid::text||':'||xmin::text,0)::numeric),0)::text stamp FROM ${quote(table)}`)).rows[0] });
  }
  return { ...spec, rows, fingerprint: createHash('sha256').update(JSON.stringify({ selected: spec.selected, stamps })).digest('hex') };
}

async function execute(client, spec) {
  // Freeze approval IDs before deleting any child records. The backup already exists.
  await client.query(`CREATE TEMP TABLE cleanup_approvals ON COMMIT DROP AS ${spec.approvals}`);
  // Legacy write mode is visible only inside this locked maintenance transaction.
  // It permits removing a source link without bypassing foreign keys or disabling triggers.
  const configuration = (await client.query('SELECT enabled FROM workspace_configuration WHERE id=true FOR UPDATE')).rows[0];
  const unlink = spec.rows.some(row => row.action === 'unlink' && row.count > 0);
  if (unlink && configuration?.enabled) await client.query('UPDATE workspace_configuration SET enabled=false WHERE id=true');
  for (const op of spec.ops) await client.query(op.sql.replaceAll(spec.approvals, 'SELECT id FROM pg_temp.cleanup_approvals'));
  if (unlink && configuration?.enabled) await client.query('UPDATE workspace_configuration SET enabled=true WHERE id=true');
  await client.query('UPDATE personal_workspaces SET analysis_revision=analysis_revision+1');
  if (spec.selected.includes('master')) await client.query('UPDATE workspace_reference_versions SET master_revision=master_revision+1');
  if (spec.selected.includes('staff')) await client.query('UPDATE workspace_reference_versions SET staff_revision=staff_revision+1');
}
module.exports = { CATEGORIES, TABLES, PRESERVED, categories, quote, tables, validateDependencies, operations, inspect, execute };

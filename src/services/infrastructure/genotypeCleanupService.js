const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const plan = require('./genotypeCleanupPlan');
const { createCleanupBackup, checksum } = require('./cleanupBackup');

const OPERATION = 'DATABASE_GENOTYPES_CLEAR';
const CONFIRMATION = 'ОЧИСТИТЬ ДАННЫЕ';
const LOCK = [1145980225, 20261117];
const terminal = state => ['completed', 'failed', 'interrupted', 'unknown'].includes(state);
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

class GenotypeCleanupService {
  constructor({ pool, gate, connectionString, backup = createCleanupBackup, directory = path.resolve('backups'), hooks = {} }) {
    this.pool = pool; this.gate = gate; this.connectionString = connectionString;
    this.backup = backup; this.directory = directory; this.hooks = hooks;
    this.previews = new Map(); this.current = null;
  }

  async authorize(user, client = this.pool) {
    const fresh = (await client.query('SELECT id, role, organization_id, is_active FROM users WHERE id=$1', [user.id])).rows[0];
    if (!fresh?.is_active || !['admin', 'system_administrator'].includes(fresh.role)) throw fail('Очистка доступна только администратору.', 403);
    if (fresh.role === 'admin') {
      const orgs = (await client.query('SELECT id FROM organizations LIMIT 2')).rows;
      if (orgs.length !== 1 || orgs[0].id !== fresh.organization_id) throw fail('Для очистки установки с несколькими организациями нужен системный администратор.', 403);
    }
    return fresh;
  }

  async users(user) {
    await this.authorize(user);
    return (await this.pool.query(`SELECT u.id,u.username,u.display_name,u.is_active,o.name organization_name
      FROM users u LEFT JOIN organizations o ON o.id=u.organization_id
      ORDER BY lower(COALESCE(NULLIF(u.display_name,''),u.username)),u.id`)).rows;
  }

  async target(user, scope, client = this.pool, lock = false) {
    if (scope?.mode !== 'user') return null;
    const target = (await client.query(`SELECT u.id,u.username,u.display_name,u.organization_id,u.is_active,o.name organization_name
      FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1 ${lock ? 'FOR SHARE OF u' : ''}`, [scope.userId])).rows[0];
    if (!target || !target.organization_id || user.role !== 'system_administrator' && target.organization_id !== user.organization_id) {
      throw fail('Пользователь недоступен для очистки.', 403);
    }
    return target;
  }

  async years(user, userId) {
    const actor = await this.authorize(user);
    const scope = plan.personalScope({mode:'user',userId}, ['personal']);
    const target = await this.target(actor, scope);
    const rows = (await this.pool.query(`SELECT year,count(*)::int count FROM dna_profiles
      WHERE user_id=$1 AND (organization_id=$2 OR organization_id IS NULL) AND COALESCE(profile_type,'user')='user'
      GROUP BY year ORDER BY year DESC NULLS LAST`, [target.id,target.organization_id])).rows;
    return {years:rows.filter(row => Number.isInteger(row.year) && row.year >= 1900 && row.year <= 2100),undatedCount:rows.find(row => row.year === null)?.count || 0};
  }

  async preview(user, input, inputScope) {
    const selected = plan.categories(input), personalScope = plan.personalScope(inputScope, selected);
    const actor = await this.authorize(user);
    if (this.current && !terminal(this.current.state)) throw fail('Дождитесь завершения текущей очистки.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const list = await plan.tables(client);
      await plan.validateDependencies(client, list);
      const targetUser = await this.target(actor, personalScope, client);
      const result = await plan.inspect(client, list, selected, targetUser, personalScope?.year ?? null);
      await client.query('COMMIT');
      const token = randomUUID(), expiresAt = Date.now() + 5 * 60 * 1000;
      for (const [key, entry] of this.previews) if (entry.expiresAt < Date.now()) this.previews.delete(key);
      while (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value);
      this.previews.set(token, { userId: user.id, ...result, list, expiresAt, personalScope, targetUser });
      return { token, expiresAt, rows: result.rows, categories: selected, categoryLabels: selected.map(key => plan.CATEGORIES[key]), resetsSearch: true, personalScope, targetUser, confirmation: CONFIRMATION, scope: targetUser ? `Пользователь: ${targetUser.display_name || targetUser.username} (${targetUser.username}), ${targetUser.organization_name}; ${personalScope?.year != null ? 'год: '+personalScope.year : 'все годы'}` : 'Вся установка: все пользователи и отделения' };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async start(user, { token, confirmation, acknowledged, categories, personalScope: inputScope }, context = {}) {
    const selected = plan.categories(categories), personalScope = plan.personalScope(inputScope, selected);
    const actor = await this.authorize(user);
    const entry = this.previews.get(token);
    if (confirmation !== CONFIRMATION || acknowledged !== true) throw fail('Подтвердите состав очистки и введите контрольную фразу.', 400);
    if (!entry || entry.userId !== user.id || entry.expiresAt < Date.now()) throw fail('Предварительный просмотр устарел. Обновите его.');
    if (JSON.stringify(personalScope) !== JSON.stringify(entry.personalScope)) throw fail('Пользователь или область очистки изменились. Обновите предварительный просмотр.');
    const targetUser = await this.target(actor, personalScope);
    if (targetUser?.organization_id !== entry.targetUser?.organization_id) throw fail('Организация пользователя изменилась. Обновите предварительный просмотр.');
    if (JSON.stringify(selected) !== JSON.stringify(entry.selected)) throw fail('Состав очистки изменился. Обновите предварительный просмотр.');
    if (personalScope?.year != null && !entry.rows.some(row => row.table === 'dna_profiles' && row.action === 'delete' && row.count > 0)) throw fail('За выбранный год нет личных генотипов для очистки.');
    if (this.current && !terminal(this.current.state)) throw fail('Очистка уже выполняется.');
    const job = { id: randomUUID(), state: 'preparing', startedAt: new Date().toISOString(), personalScope, targetUser, categories: entry.selected, categoryLabels: entry.selected.map(key => plan.CATEGORIES[key]), rows: entry.rows, backup: null };
    this.current = job; this.previews.delete(token);
    try {
      await this.pool.query(`INSERT INTO operation_history(id,user_id,operation_type,operation_details,success,ip_address,user_agent)
        VALUES($1,$2,$3,$4,false,$5,$6)`, [job.id, user.id, OPERATION, JSON.stringify(job), context.ip || null, (context.userAgent || '').slice(0, 1000)]);
    } catch (error) { this.current = null; throw error; }
    // Keep the request short; the UI polls the persistent operation record.
    this.running = this.gate.allow(() => this.run(user, job, entry));
    return { ...job };
  }

  async persist(job, client = this.pool) {
    await client.query('UPDATE operation_history SET operation_details=$2,success=$3 WHERE id=$1 AND operation_type=$4',
      [job.id, JSON.stringify(job), job.state === 'completed', OPERATION]);
  }

  async run(user, job, entry) {
    let client, locked = false, transaction = false, closed = false, resume;
    let commitAttempted = false;
    try {
      client = await this.pool.connect();
      locked = (await client.query('SELECT pg_try_advisory_lock($1,$2) locked', LOCK)).rows[0].locked;
      if (!locked) throw fail('Другая очистка уже выполняется.');
      const peers = await client.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='dna_analysis_app' AND client_addr IS DISTINCT FROM inet_client_addr() LIMIT 1`);
      if (peers.rowCount) throw fail('Очистка требует одного работающего экземпляра веб-приложения.');
      job.state = 'waiting'; await this.persist(job);
      resume = this.hooks.resume;
      await this.hooks.pause?.();
      this.gate.close(); closed = true;
      await this.gate.drain();
      await this.hooks.clearConverter?.();
      // Acquire write locks before reading the cleanup snapshot. READ COMMITTED
      // sees writers that committed while LOCK was waiting.
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); transaction = true;
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10min'; SET LOCAL idle_in_transaction_session_timeout='15min'");
      const actor = await this.authorize(user, client);
      const targetUser = await this.target(actor, entry.personalScope, client, true);
      if (targetUser?.organization_id !== entry.targetUser?.organization_id) throw fail('Организация пользователя изменилась. Очистка не выполнена.');
      const list = await plan.tables(client);
      if (!list.length) throw fail('Таблицы генотипов не найдены.');
      // Reads, including pg_dump, remain possible; all data writers are blocked.
      await client.query(`LOCK TABLE ${list.map(plan.quote).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      await plan.validateDependencies(client, list);
      const current = await plan.inspect(client, list, entry.selected, targetUser, entry.personalScope?.year ?? null);
      if (current.fingerprint !== entry.fingerprint) throw fail('Данные изменились после предварительного просмотра. Обновите его; очистка не выполнена.');
      job.rows = current.rows;
      const exported = (await client.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const disk = await fs.statfs(this.directory);
      const size = Number((await client.query('SELECT pg_database_size(current_database())::text bytes')).rows[0].bytes);
      if (Number(disk.bavail) * Number(disk.bsize) < size * 1.5 + 128 * 1024 * 1024) throw fail('Недостаточно места для резервной копии. Очистка не выполнена.');
      job.state = 'backing_up'; await this.persist(job);
      job.backup = await this.backup({ connectionString: this.connectionString, snapshot: exported, id: job.id, directory: this.directory });
      job.state = 'clearing'; await this.persist(job);
      await plan.execute(client, current);
      const completed = { ...job, state: 'completed', finishedAt: new Date().toISOString() };
      await this.persist(completed, client);
      commitAttempted = true;
      await client.query('COMMIT'); transaction = false;
      Object.assign(job, completed);
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      if (commitAttempted) {
        // A lost COMMIT reply must never be reported as a guaranteed rollback.
        try {
          const saved = (await this.pool.query('SELECT operation_details FROM operation_history WHERE id=$1', [job.id])).rows[0]?.operation_details;
          if (saved?.state === 'completed') Object.assign(job, saved);
          else { job.state = 'failed'; job.message = 'Транзакция отменена. Данные не очищены.'; }
        } catch { job.state = 'unknown'; job.message = 'Связь с БД прервана. Проверьте журнал операции перед повторным запуском.'; }
      } else {
        job.state = 'failed'; job.message = error.status ? error.message : 'Не удалось создать копию или выполнить очистку. Транзакция отменена; данные не очищены.';
      }
      job.finishedAt = new Date().toISOString();
      await this.persist(job).catch(() => {});
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock($1,$2)', LOCK).catch(() => {});
      client?.release();
      if (closed) this.gate.open();
      if (resume) await this.gate.normal(resume).catch(() => {});
    }
  }

  async status(user, id) {
    await this.authorize(user);
    const result = await this.pool.query(`SELECT operation_details FROM operation_history WHERE operation_type=$1 ${id ? 'AND id=$2' : ''} ORDER BY timestamp DESC LIMIT 1`, id ? [OPERATION, id] : [OPERATION]);
    const job = result.rows[0]?.operation_details;
    if (!job) return null;
    if (this.current?.id === job.id) return { ...this.current };
    if (!terminal(job.state)) return { ...job, state: 'interrupted', message: 'Приложение перезапущено во время операции. Проверьте журнал и резервную копию перед повторным запуском.' };
    return job;
  }

  async backupFile(user, id) {
    const job = await this.status(user, id);
    const filename = `genotypes-before-cleanup-${id}.dump`;
    if (!job?.backup || job.backup.filename !== filename) throw fail('Резервная копия этой операции недоступна.', 404);
    const file = path.join(this.directory, filename);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== job.backup.bytes) throw fail('Резервная копия недоступна или изменена.', 409);
    if (await checksum(file) !== job.backup.sha256) throw fail('Контрольная сумма резервной копии не совпадает.', 409);
    return { file, filename };
  }
}

module.exports = { GenotypeCleanupService, CONFIRMATION };

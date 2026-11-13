const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { calculate, ProbabilityError, ROLES, FORMULA_VERSION, participantRoles, probabilityDisplay } = require('../services/probability/ProbabilityCalculationService');
const { previewTxt, databaseSource } = require('../services/probability/ProbabilitySources');
const { ProbabilityStore } = require('../services/probability/ProbabilityStore');
const { probabilityExportFilename } = require('../utils/probabilityExportFilename');
const { reportData, exportXlsx } = require('../services/probability/probabilityReport');
const reference = require('../services/probability/data/workbook-reference.json');
const { resolveProfileImportFormat } = require('../utils/profileImportFormat');
const { workspaceModeEnabled } = require('../services/workspace/workspaceMode');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createProbabilityRouter(deps = {}) {
  const router = express.Router();
  const authenticate = deps.authenticate || require('../middleware/auth').authenticate;
  const query = deps.query || require('../config/database').query;
  const getScope = deps.getScope || (context => require('../services/security/profileAccessService').ProfileAccessService.getScope(context));
  const getStore = () => deps.store || new ProbabilityStore(query, require('../config/security').securityConfig.encryptionKey);
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 2 * 1024 * 1024, fields: 0, parts: 11 },
    fileFilter: (req, file, done) => done(/\.txt$/i.test(file.originalname) ? null : new ProbabilityError('Допускаются только GeneMapper TXT.'), /\.txt$/i.test(file.originalname)) }).array('files', 10);
  router.use(authenticate);
  router.use(async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (!['admin','system_administrator','department_head','user_analyst','analyst'].includes(req.user.role)) throw new ProbabilityError('Нет прав на расчёт.', 'PROBABILITY_FORBIDDEN', 403);
      if (!workspaceModeEnabled() && (!uuid.test(req.activeDepartmentId || '') || req.get('X-Active-Department-Id') !== req.activeDepartmentId)) throw new ProbabilityError('Выберите активное отделение.', 'DEPARTMENT_REQUIRED', 403);
      req.probabilityScope = await getScope({ userId: req.user.id, activeDepartmentId: req.activeDepartmentId, action: 'read' });
      if (workspaceModeEnabled()) { req.probabilityContext = { userId: req.user.id, departmentId: null, organizationId: req.user.organization_id }; return next(); }
      const { rows } = await query('SELECT id,name,organization_id FROM departments WHERE id=$1 AND is_active=true', [req.activeDepartmentId]);
      const department = rows[0];
      if (resolveProfileImportFormat(department) !== 'genetic' || department.organization_id !== (req.probabilityScope.organizationId || req.probabilityScope.params[1])) throw new ProbabilityError('Раздел доступен только в «Генетических экспертизах».', 'PROBABILITY_DEPARTMENT_DENIED', 403);
      req.probabilityContext = { userId: req.user.id, departmentId: department.id, organizationId: department.organization_id };
      next();
    } catch (error) { next(error); }
  });
  router.use(rateLimit({ windowMs: 60 * 1000, max: 90, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Слишком много запросов. Повторите через минуту.' } }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  async function profile(req, id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw new ProbabilityError('Некорректный идентификатор профиля.');
    const { clause, params } = req.probabilityScope;
    const { rows } = await query(`SELECT dp.id,dp.internal_number,dp.sample_name,dp.year,dp.str_data,to_jsonb(dp)->>'expertise_type' AS expertise_type FROM dna_profiles dp WHERE ${clause} AND dp.id=$${params.length + 1}`, [...params, id]);
    if (!rows[0]) throw new ProbabilityError('Профиль не найден или недоступен.', 'PROFILE_NOT_FOUND', 404);
    return databaseSource(rows[0]);
  }
  async function resolveInput(req) {
    const input = req.body;
    if (!input) throw new ProbabilityError('Выберите режим и участников.');
    const activeRoles = participantRoles(input.mode, input.participants);
    if (input.formulaVersion && input.formulaVersion !== FORMULA_VERSION) throw new ProbabilityError('Версия формул изменилась. Обновите страницу.', 'FORMULA_VERSION_CHANGED', 409);
    if (input.referenceId && input.referenceId !== reference.id) throw new ProbabilityError('Версия частот изменилась. Обновите страницу.', 'REFERENCE_VERSION_CHANGED', 409);
    const participants = [];
    for (const p of input.participants) {
      if (!activeRoles.includes(p.role)) throw new ProbabilityError('Некорректная роль.');
      let source;
      if (p.sourceType === 'database') {
        source = await profile(req, p.sourceId);
        if (p.sourceDigest && source.sourceDigest !== p.sourceDigest) throw new ProbabilityError('Исходный профиль изменился. Выберите его заново, чтобы проверить новые значения.', 'PROFILE_SOURCE_CHANGED', 409);
      }
      else if (p.sourceType === 'txt') {
        if (typeof p.proof !== 'string' || p.proof.length > 250000) throw new ProbabilityError('Повторно загрузите TXT.');
        let sealed;
        try { sealed = getStore().open(p.proof); } catch { throw new ProbabilityError('Подпись TXT недействительна.', 'TXT_PROOF_INVALID'); }
        const c = req.probabilityContext;
        if (sealed.userId !== c.userId || sealed.departmentId !== c.departmentId || sealed.organizationId !== c.organizationId || sealed.expiresAt < Date.now() || !sealed.source?.selectable) throw new ProbabilityError('TXT недоступен в этом контексте или истёк срок предпросмотра.', 'TXT_PROOF_EXPIRED', 403);
        source = sealed.source;
      } else if (p.sourceType === 'manual') {
        if (typeof p.displayName !== 'string' || p.displayName.length > 150) throw new ProbabilityError('Укажите подпись ручного профиля (до 150 символов).');
        source = { sourceType: 'manual', sourceId: null, displayName: p.displayName.trim() || 'Ручной ввод', loci: {}, qualityFlags: [] };
      } else throw new ProbabilityError('Неизвестный источник профиля.');
      const overrides = p.manualOverrides || {};
      if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object' || Object.keys(overrides).length > 510) throw new ProbabilityError('Некорректные изменения генотипа.');
      // Canonicalization also detects conflicting aliases, rather than last-write wins.
      const { normalizeLoci } = require('../services/probability/ProbabilityCalculationService');
      const normalized = normalizeLoci(overrides);
      if (normalized.conflicts.length) throw new ProbabilityError('Конфликт имён локусов в ручных изменениях.');
      participants.push({ ...source, role: p.role, sourceSnapshot: { loci: source.loci, rawLoci: source.rawLoci || source.loci, qualityFlags: source.qualityFlags },
        manualOverrides: normalized.loci, loci: { ...source.loci, ...normalized.loci },
        qualityFlags: source.qualityFlags.filter(f => !Object.hasOwn(normalized.loci, f.locus)) });
    }
    return { mode: input.mode, participants, includedLoci: input.includedLoci };
  }
  const withReport = c => ({ ...c,
    summary: c.summary ? { ...c.summary, ...probabilityDisplay(c.summary, c.mode) } : null,
    report: c.summary ? reportData(c) : null });
  router.get('/configuration', route(async (req, res) => res.json({ formulaVersion: FORMULA_VERSION, reference: { id: reference.id, label: reference.label }, modes: ROLES,
    loci: Object.keys(reference.frequencies), calculationLoci: require('../utils/probabilityLoci').calculationLoci, mutationProbability: 0.001 })));
  router.get('/profile-search', route(async (req, res) => {
    if (typeof req.query.q !== 'string' || req.query.q.trim().length < 1 || req.query.q.length > 100) throw new ProbabilityError('Введите от 1 до 100 символов.');
    const { clause, params } = req.probabilityScope, values = [...params, '%' + req.query.q.trim().replace(/[\\%_]/g, '\\$&') + '%'];
    const idx = values.length;
    const { rows } = await query(`SELECT dp.id,dp.internal_number,dp.sample_name,dp.year,to_jsonb(dp)->>'expertise_type' AS expertise_type FROM dna_profiles dp WHERE ${clause}
      AND (dp.internal_number ILIKE $${idx} ESCAPE '\\' OR dp.sample_name ILIKE $${idx} ESCAPE '\\' OR dp.notes ILIKE $${idx} ESCAPE '\\')
      ORDER BY dp.year DESC,dp.internal_number,dp.id LIMIT 30`, values);
    res.json({ profiles: rows.map(r => ({ id: r.id, displayName: r.internal_number || r.sample_name, year: r.year, expertiseNumber: r.sample_name })) });
  }));
  router.get('/profiles/:id', route(async (req, res) => res.json(await profile(req, req.params.id))));
  router.post('/txt/preview', upload, route(async (req, res) => {
    if ((req.files || []).reduce((size, f) => size + f.size, 0) > 20 * 1024 * 1024) throw new ProbabilityError('Общий размер TXT превышает 20 МиБ.', 'TXT_TOO_LARGE', 413);
    let files;
    try { files = previewTxt(req.files || []); } catch (error) { if (error instanceof ProbabilityError) throw error; throw new ProbabilityError(error.message, 'TXT_INVALID'); }
    for (const file of files) for (const sample of file.samples) if (sample.selectable)
      sample.proof = getStore().seal({ ...req.probabilityContext, expiresAt: Date.now() + 12 * 60 * 60 * 1000, source: sample });
    res.json({ files });
  }));
  router.post('/calculate', route(async (req, res) => res.json(withReport(calculate(await resolveInput(req))))));
  router.post('/calculations', route(async (req, res) => res.status(201).json(withReport(await getStore().save(req.probabilityContext, calculate(await resolveInput(req)))))));
  router.get('/calculations', route(async (req, res) => res.json({ calculations: await getStore().list(req.probabilityContext) })));
  async function saved(req) {
    if (!uuid.test(req.params.id)) throw new ProbabilityError('Некорректный идентификатор расчёта.');
    const calculation = await getStore().get(req.probabilityContext, req.params.id);
    if (!calculation) throw new ProbabilityError('Расчёт не найден или недоступен.', 'CALCULATION_NOT_FOUND', 404);
    return calculation;
  }
  router.get('/calculations/:id', route(async (req, res) => res.json(withReport(await saved(req)))));
  async function sendXlsx(res, calculation) {
    if (!calculation.summary) throw new ProbabilityError('Исправьте или исключите блокирующие локусы перед экспортом.', 'CALCULATION_BLOCKED', 409);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(probabilityExportFilename(calculation)).send(Buffer.from(await exportXlsx(calculation)));
  }
  router.get('/calculations/:id/export', route(async (req, res) => {
    const c = await saved(req);
    if (!c.summary) throw new ProbabilityError('В сохранённом расчёте нет числового результата.', 'CALCULATION_BLOCKED', 409);
    if (req.query.format === 'report') return res.json(reportData(c));
    if (req.query.format && req.query.format !== 'xlsx') throw new ProbabilityError('PNG формируется клиентом из подтверждённого отчёта. Используйте format=xlsx или report.');
    await sendXlsx(res, c);
  }));
  router.post('/export', route(async (req, res) => sendXlsx(res, calculate(await resolveInput(req)))));
  router.use((error, req, res, next) => {
    const known = error instanceof ProbabilityError || error instanceof multer.MulterError || error.code === 'PROFILE_ACCESS_DENIED';
    if (!known && !deps.silent) require('../utils/logger').logger.error('Probability request failed', { requestId: req.requestId, code: error.code || 'PROBABILITY_FAILED' });
    res.status(known ? error.status || 400 : 500).json({ code: known ? error.code : 'PROBABILITY_FAILED', message: known ? error.message : 'Не удалось выполнить операцию с расчётом.' });
  });
  return router;
}
module.exports = createProbabilityRouter;

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { GenotypePanel, PanelError } = require('../models/GenotypePanel');
const { AlleleReferenceSet } = require('../models/AlleleReferenceSet');
const { validateReferenceImport, ReferenceError, REFERENCE_TYPES } = require('../utils/alleleReferenceImport');
const PopulationManager = require('../services/bayesian/PopulationManager');
const { logger } = require('../utils/logger');
router.use(authenticate);
router.use(async (req, res, next) => {
  try { req.referenceScope = await GenotypePanel.scope({ departmentId: req.activeDepartmentId, organizationId: req.user.organization_id, role: req.user.role }); next(); }
  catch (error) { respond(req, res, error); }
});
function respond(req, res, error) {
  if (error instanceof ReferenceError || error instanceof PanelError) return res.status(error.status).json({ code: error.code, message: error.message });
  if (error.code === '23505') return res.status(409).json({ code: 'REFERENCE_VERSION_EXISTS', message: 'Эта версия уже существует. Импортируйте данные под новой версией.' });
  logger.error('Ошибка справочника аллелей', { code: error.code || 'REFERENCE_ERROR', requestId: req.requestId });
  res.status(500).json({ code: 'REFERENCE_ERROR', message: 'Не удалось обработать справочник.' });
}
const handle = fn => async (req, res) => { try { res.set('Cache-Control', 'private, no-store'); await fn(req, res); } catch (error) { respond(req, res, error); } };
function edit(req, res, next) {
  if (!['system_administrator', 'admin', 'department_head'].includes(req.user.role)) return res.status(403).json({ code: 'REFERENCE_EDIT_DENIED', message: 'Недостаточно прав для изменения справочников.' });
  next();
}
router.get('/types', handle(async (req, res) => res.json({ types: REFERENCE_TYPES })));
router.get('/templates/promega-fusion-tmd039-2020', handle(async (req, res) => res.json(require('../data/allele-references/promega-fusion-tmd039-2020.json'))));
router.get('/populations', handle(async (req, res) => res.json({ populations: await new PopulationManager().listAvailablePopulations() })));
router.get('/', handle(async (req, res) => res.json({ references: await AlleleReferenceSet.list(req.referenceScope, req.query.includeInactive === 'true') })));
router.post('/validate', edit, handle(async (req, res) => {
  const set = validateReferenceImport(req.body);
  res.json({ valid: true, valueCount: set.values.length, loci: [...new Set(set.values.map(value => value.locus))], preview: set.values.slice(0, 50), contentHash: set.contentHash });
}));
router.post('/', edit, handle(async (req, res) => res.status(201).json({ reference: await AlleleReferenceSet.create(req.body, req.referenceScope, req.user.id) })));
router.get('/:id/compare', handle(async (req, res) => res.json(await AlleleReferenceSet.compare(req.params.id, req.query.other, req.referenceScope))));
router.get('/:id', handle(async (req, res) => {
  const [reference] = await AlleleReferenceSet.values([await AlleleReferenceSet.find(req.params.id, req.referenceScope)]);
  const values = req.query.locus ? reference.values.filter(value => value.locus === req.query.locus) : reference.values;
  res.json({ ...reference, values });
}));
router.patch('/:id', edit, handle(async (req, res) => {
  if (Object.keys(req.body).some(key => key !== 'isActive')) throw new ReferenceError('Содержимое версии неизменно: создайте новую версию.');
  res.json({ reference: await AlleleReferenceSet.setActive(req.params.id, req.body.isActive, req.referenceScope) });
}));
module.exports = router;

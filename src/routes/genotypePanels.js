const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { GenotypePanel, PanelError } = require('../models/GenotypePanel');
const { logger } = require('../utils/logger');
router.use(authenticate);
router.use(async (req, res, next) => {
  try {
    req.panelScope = await GenotypePanel.scope({ departmentId: req.activeDepartmentId, organizationId: req.user.organization_id, role: req.user.role });
    next();
  } catch (error) { respond(req, res, error); }
});
const editors = new Set(['system_administrator', 'admin', 'department_head']);
function edit(req, res, next) {
  if (!editors.has(req.user.role)) return res.status(403).json({ code: 'PANEL_EDIT_DENIED', message: 'Недостаточно прав для изменения панелей.' });
  next();
}
function respond(req, res, error) {
  if (error.code === '23505') return res.status(409).json({ code: 'PANEL_NAME_EXISTS', message: 'Панель с таким названием уже существует в отделении.' });
  if (error instanceof PanelError) return res.status(error.status).json({ code: error.code, message: error.message });
  logger.error('Ошибка справочника панелей', { error: error.message, requestId: req.requestId });
  res.status(500).json({ code: 'PANEL_ERROR', message: 'Не удалось выполнить операцию с панелью.', requestId: req.requestId });
}
const handle = fn => async (req, res) => { try { await fn(req, res); } catch (error) { respond(req, res, error); } };
router.get('/loci', handle(async (req, res) => res.json({ loci: GenotypePanel.catalog() })));
router.get('/', handle(async (req, res) => res.json({ panels: await GenotypePanel.list(req.panelScope, req.query.includeInactive === 'true') })));
router.get('/:id', handle(async (req, res) => res.json({ panel: await GenotypePanel.find(req.params.id, req.panelScope) })));
router.post('/', edit, handle(async (req, res) => res.status(201).json({ panel: await GenotypePanel.create(req.body, req.panelScope, req.user.id) })));
router.put('/:id', edit, handle(async (req, res) => res.json({ panel: await GenotypePanel.update(req.params.id, req.body, req.panelScope, req.user.id) })));
router.delete('/:id', edit, handle(async (req, res) => res.json({ panel: await GenotypePanel.deactivate(req.params.id, req.panelScope, req.user.id) })));
module.exports = router;

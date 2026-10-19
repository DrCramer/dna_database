const express = require('express');
const Joi = require('joi');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const OperationHistory = require('../models/OperationHistory');
const { XLSX_MIME } = require('../services/audit/duplicateExcelExportService');
const { MasterArrayExcelExportService } = require('../services/converters/masterArrayExcelExportService');

const router = express.Router();
const service = new MasterArrayExcelExportService();
const admins = authorize(['admin', 'system_administrator']);
const schema = Joi.object({
  filters: Joi.object({ yearFrom: Joi.number().integer().min(1900).max(2100), yearTo: Joi.number().integer().min(1900).max(2100), objectQuery: Joi.string().trim().max(100).allow('') }).custom((value, helpers) => value.yearFrom != null && value.yearTo != null && value.yearFrom > value.yearTo ? helpers.error('any.invalid') : value).default({}),
  options: Joi.object({
    hideEmptyLoci: Joi.boolean().default(true), includeCatalogLoci: Joi.boolean().default(false),
    exportValidOnly: Joi.boolean().default(false), confirmValidOnly: Joi.boolean().default(false),
    previewFingerprint: Joi.string().hex().length(64), includeInactive: Joi.boolean().valid(false).default(false)
  }).default()
}).options({ convert: false, abortEarly: false });

router.get('/export/options', authenticate, admins, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json({ arrays: await service.list(req.user) }); }
  catch { res.status(500).json({ message: 'Не удалось получить доступные мастер-массивы.' }); }
});

for (const operation of ['preview', 'xlsx']) router.post(`/:masterArrayId/export/${operation}`, authenticate, admins, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const validId = Joi.string().guid().validate(req.params.masterArrayId);
  const { value, error } = schema.validate(req.body);
  if (validId.error || error) return res.status(400).json({ message: 'Проверьте идентификатор, фильтры и настройки экспорта.' });
  const audit = { userId: req.user.id, requestId: req.requestId, masterArrayId: req.params.masterArrayId, filters: value.filters, operation };
  try {
    const result = await service.inspect(req.user, req.params.masterArrayId, value, operation === 'xlsx');
    const summary = result.preview || result;
    const details = { ...audit, organizationId: summary.masterArray.organizationId, status: 'success', totalMatched: summary.totalMatched, exportable: summary.exportable,
      needsReview: summary.needsReview, exportRows: summary.totalExportRows, validOnly: value.options.exportValidOnly, bytes: result.buffer?.length || 0 };
    // Файл отдаётся только после сохранения аудита; генотипы и содержимое XLSX в журнал не попадают.
    await OperationHistory.logOperation({ userId: req.user.id, departmentId: summary.masterArray.departmentId, operationType: 'MASTER_ARRAY_EXPORT',
      operationDetails: details, affectedResources: { masterArrayId: req.params.masterArrayId }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    logger.info('MASTER_ARRAY_EXPORT', details);
    if (operation === 'preview') return res.json(result);
    res.set({ 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="master-array.xlsx"; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'X-Content-Type-Options': 'nosniff' });
    res.send(result.buffer);
  } catch (failure) {
    const details = { ...audit, status: 'failed', code: failure.code || 'EXPORT_ERROR', statusCode: failure.status || 500 };
    logger.warn('MASTER_ARRAY_EXPORT', details);
    await OperationHistory.logOperation({ userId: req.user.id, operationType: 'MASTER_ARRAY_EXPORT', operationDetails: details,
      affectedResources: { masterArrayId: req.params.masterArrayId }, success: false, ipAddress: req.ip, userAgent: req.get('User-Agent') })
      .catch(() => logger.error('MASTER_ARRAY_EXPORT_AUDIT_FAILED', { userId: req.user.id, requestId: req.requestId }));
    res.status(failure.status || 500).json({ message: failure.status ? failure.message : 'Не удалось выполнить выгрузку.', code: failure.code || 'EXPORT_ERROR' });
  }
});

module.exports = router;

const express = require('express');
const {
  pipeline
} = require('node:stream/promises');
const Joi = require('joi');
const {
  authenticate,
  authorize
} = require('../middleware/auth');
const {
  LegacyMigrationExportService
} = require('../services/converters/legacyMigrationExportService');
const OperationHistory = require('../models/OperationHistory');
const schema = Joi.object({
  sources: Joi.array().unique().items(Joi.string().valid('master', 'user', 'staff')).required(),
  years: Joi.array().unique().items(Joi.number().integer().min(1900).max(2100).allow(null)).required(),
  departments: Joi.array().unique().items(Joi.string().guid().allow(null)).required(),
  types: Joi.array().unique().items(Joi.string().valid('chs', 'ug', 'gr', 'staff').allow(null)).required(),
  includeEmpty: Joi.boolean().default(true),
  includeInactive: Joi.boolean().default(false),
  objectQuery: Joi.string().max(100).allow(''),
  previewFingerprint: Joi.string().hex().length(64)
}).options({
  convert: false,
  abortEarly: false
});
module.exports = function legacyMigrationExportRouter(service = new LegacyMigrationExportService()) {
  const router = express.Router();
  router.use(authenticate, authorize(['admin', 'system_administrator']));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.get('/options', async (req, res, next) => {
    try {
      res.json(await service.options(req.user));
    } catch (e) {
      next(e);
    }
  });
  for (const operation of ['preview', 'xlsx']) router.post('/' + operation, async (req, res, next) => {
    const {
      value,
      error
    } = schema.validate(req.body);
    if (error) return res.status(400).json({
      message: 'Проверьте источники и выбранные фильтры выгрузки.'
    });
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    let result;
    try {
      result = await service.inspect(req.user, value, operation === 'xlsx', {
        asStream: operation === 'xlsx',
        signal: controller.signal
      });
      const stats = result.stats || result;
      await OperationHistory.logOperation({
        userId: req.user.id,
        operationType: 'LEGACY_MIGRATION_EXPORT',
        operationDetails: {
          organizationId: req.user.organization_id,
          operation,
          total: stats.total,
          fingerprint: stats.fingerprint
        },
        affectedResources: {},
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      if (operation === 'preview') return res.json(result);
      res.set({
        'Content-Type': result.mime,
        'Content-Disposition': `attachment; filename="genotypes.${result.mime === 'application/zip' ? 'zip' : 'xlsx'}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
      });
      if (result.stream) await pipeline(result.stream, res);else res.send(result.buffer);
    } catch (e) {
      if (!res.headersSent && !res.destroyed) next(e);
    } finally {
      req.removeListener('aborted', cancel);
      res.removeListener('close', cancel);
      await result?.cleanup?.();
    }
  });
  router.use((e, req, res, next) => res.status(e.status || 500).json({
    message: e.status ? e.message : 'Не удалось выполнить выгрузку. Ни одна запись не была пропущена автоматически.'
  }));
  return router;
};

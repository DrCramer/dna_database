const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { authenticate, authorize } = require('../middleware/auth');
const { pool } = require('../config/database');
const { maintenanceGate } = require('../services/infrastructure/databaseMaintenanceGate');
const { GenotypeCleanupService } = require('../services/infrastructure/genotypeCleanupService');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = function databaseMaintenance() {
  const router = express.Router();
  let resumeNight = null;
  const service = new GenotypeCleanupService({ pool, gate: maintenanceGate, connectionString: process.env.DATABASE_URL,
    hooks: {
      async pause() {
        const night = router.application?.locals.nightSearch;
        if (!night || night.stopped) return;
        resumeNight = () => night.start();
        await night.stop();
        const until = Date.now() + 60000;
        while (night.scheduling) {
          if (Date.now() > until) throw Object.assign(Error('Планировщик ещё завершает работу. Повторите позже.'), { status: 409 });
          await delay(50);
        }

      },
      async resume() { const start = resumeNight; resumeNight = null; if (start) await start(); },
      clearConverter: () => require('../services/converters/converterWorkerExecutor').converterWorker.close()
    }
  });
  router.use((req, res, next) => { router.application = req.app; res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate, authorize(['admin', 'system_administrator']));
  const previewLimit = rateLimit({ windowMs: 60000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Слишком много запросов. Повторите через минуту.' } });
  const startLimit = rateLimit({ windowMs: 600000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Повторите запуск очистки позже.' } });
  const categorySchema = Joi.array().items(Joi.string().valid('personal', 'master', 'staff', 'results')).min(1).max(4).unique().required();
  const personalScopeSchema = Joi.object({ mode: Joi.string().valid('all','user').required(), year: Joi.when('mode', {is:'user',then:Joi.number().integer().min(1900).max(2100),otherwise:Joi.forbidden()}), userId: Joi.when('mode', { is: 'user', then: Joi.string().guid().required(), otherwise: Joi.forbidden() }) });
  const body = Joi.object({ personalScope: personalScopeSchema.allow(null), categories: categorySchema, token: Joi.string().guid().required(), confirmation: Joi.string().max(100).required(), acknowledged: Joi.boolean().valid(true).required() }).options({ convert: false, allowUnknown: false });
  const uuid = Joi.string().guid();
  const handle = action => async (req, res) => {
    try { await action(req, res); }
    catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Не удалось выполнить операцию обслуживания.' }); }
  };
  router.get('/users/:id/years', handle(async (req, res) => {
    if (uuid.validate(req.params.id).error) return res.status(400).json({message:'Неверный идентификатор пользователя.'});
    res.json(await service.years(req.user,req.params.id));
  }));
  router.get('/users', handle(async (req, res) => res.json({ users: await service.users(req.user) })));
  router.get('/preview', previewLimit, handle(async (req, res) => res.json(await service.preview(req.user, typeof req.query.categories === 'string' ? req.query.categories.split(',') : null, req.query.personalMode !== undefined || req.query.personalUserId !== undefined || req.query.year !== undefined ? { mode: req.query.personalMode, ...(req.query.personalUserId !== undefined ? { userId: req.query.personalUserId } : {}), ...(req.query.year !== undefined ? {year: typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year) ? Number(req.query.year) : NaN} : {}) } : null))));
  router.get('/status', handle(async (req, res) => res.json({ job: await service.status(req.user) })));
  router.post('/execute', startLimit, handle(async (req, res) => {
    const valid = body.validate(req.body);
    if (valid.error) return res.status(400).json({ message: 'Требуется актуальный просмотр, контрольная фраза и подтверждение.' });
    res.status(202).json({ job: await service.start(req.user, valid.value, { ip: req.ip, userAgent: req.get('User-Agent') }) });
  }));
  router.get('/:id/backup', handle(async (req, res) => {
    if (uuid.validate(req.params.id).error) return res.status(400).json({ message: 'Неверный идентификатор операции.' });
    const backup = await service.backupFile(req.user, req.params.id);
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(backup.file, backup.filename);
  }));
  return router;
};

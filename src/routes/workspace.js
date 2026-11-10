const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const {
  authenticate
} = require('../middleware/auth');
const {
  WorkspaceSearchService
} = require('../services/workspace/workspaceSearchService');
const {
  workspaceModeEnabled
} = require('../services/workspace/workspaceMode');
function workbookDownload(res, filename) {
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="genotypes.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
  });
  return res;
}
const ids = Joi.array().min(1).max(10000).unique().items(Joi.string().guid()).required();
const searchSchema = Joi.object({
  ids,
  parameters: Joi.object({
    minMatches: Joi.number().integer().min(1).max(500),
    ignoredLoci: Joi.array().max(510).items(Joi.string().max(100)),
    comparisonAlgorithm: Joi.string().valid('standard', 'duplicate_v5', 'contamination'),
    duplicateSettings: Joi.object({
      minScore: Joi.number().min(0),
      minPercentage: Joi.number().min(0).max(100),
      minLoci: Joi.number().integer().min(1).max(500),
      locusWeights: Joi.object().pattern(/^.{1,100}$/, Joi.number().min(0).max(100))
    }),
    staffOptions: Joi.object({
      minLociMatch: Joi.number().integer().min(1).max(500),
      criticalAlleleCount: Joi.number().integer().min(1).max(100),
      weightCriticalLocus: Joi.number().min(0).max(100),
      stutterThreshold: Joi.number().min(0).max(1),
      threshold: Joi.number().min(0).max(100),
      useV4Algorithm: Joi.boolean(),
      useV5Algorithm: Joi.boolean()
    })
  }).default({})
}).options({
  convert: false
});
const revision = Joi.number().integer().min(1).required();
const patch = Joi.object({
  draftRowId: Joi.string().guid().required(),
  included: Joi.boolean(),
  objectNumber: Joi.string().max(100).allow(''),
  year: Joi.number().integer().allow(null),
  expertiseType: Joi.string().valid('chs', 'ug', 'gr', 'staff').allow(null),
  fullName: Joi.string().max(200).allow(''),
  registrationNumber: Joi.string().max(100).allow('', null),
  comment: Joi.string().max(20000).allow(''),
  strData: Joi.object().max(510).pattern(/^.{1,100}$/, Joi.array().max(100).items(Joi.string().max(500)))
});
module.exports = function workspaceRouter(service = new WorkspaceSearchService()) {
  const router = express.Router(),
    upload = multer({
      storage: require('../services/infrastructure/boundedUploadStorage').boundedUploadStorage(),
      limits: {
        files: 100,
        fileSize: 10 * 1024 * 1024,
        fields: 0,
        parts: 101
      },
      fileFilter: (req, file, done) => /\.(xlsx|xls|txt)$/i.test(file.originalname) ? done(null, true) : done(Object.assign(new Error('Допускаются только XLSX, XLS и TXT.'), {
        status: 400
      }))
    }).array('files', 100);
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) res.once('finish', () => {
      require('../models/OperationHistory').logOperation({
        userId: req.user.id,
        operationType: 'WORKSPACE_OPERATION',
        operationDetails: {
          organizationId: req.user.organization_id,
          method: req.method,
          route: req.route?.path || 'unknown',
          selectedCount: Array.isArray(req.body?.ids) ? req.body.ids.length : null
        },
        success: res.statusCode < 400,
        affectedResources: {},
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }).catch(() => require('../utils/logger').logger.error('WORKSPACE_AUDIT_FAILED', {
        requestId: req.requestId
      }));
    });
    next();
  });
  router.get('/config', async (req, res, next) => {
    try {
      const enabled = workspaceModeEnabled() && (await service.pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0]?.enabled;
      res.json({
        enabled: !!enabled
      });
    } catch (e) {
      if (e.code === '42P01') return res.json({
        enabled: false
      });
      next(e);
    }
  });
  router.use(async (req, res, next) => {
    try {
      if (!workspaceModeEnabled() || !(await service.pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0]?.enabled) return res.status(503).json({
        message: 'Новый рабочий процесс ещё не включён. Требуется согласованное переключение.'
      });
      next();
    } catch (e) {
      next(e);
    }
  });
  const handle = fn => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
  const check = (schema, value) => {
    const result = schema.validate(value, {
      convert: false
    });
    if (result.error) throw Object.assign(new Error('Проверьте поля запроса.'), {
      status: 400
    });
    return result.value;
  };
  const uuid = value => check(Joi.string().guid().required(), value);
  router.get('/', handle(async (req, res) => res.json(await service.list(req.user))));
  router.get('/profiles', handle(async (req, res) => res.json(await service.list(req.user))));
  router.patch('/profiles/:id', handle(async (req, res) => {
    const value = check(patch.fork('draftRowId', s => s.forbidden()), req.body);
    res.json(await service.patch(req.user, uuid(req.params.id), value));
  }));
  router.post('/profiles/delete', handle(async (req, res) => {
    const value = check(Joi.object({
      ids
    }), req.body);
    res.json(await service.remove(req.user, value.ids));
  }));
  router.post('/profiles/export', handle(async (req, res) => {
    const value = check(Joi.object({
      ids
    }), req.body);
    workbookDownload(res, 'Генотипы_' + new Date().toISOString().slice(0, 10) + '.xlsx').send(await service.exportProfiles(req.user, value.ids));
  }));
  router.patch('/search-settings', handle(async (req, res) => {
    const value = check(searchSchema.fork('ids', s => s.forbidden()), req.body);
    res.json({
      parameters: await service.configureSearch(req.user, value.parameters)
    });
  }));
  router.post('/full-search', handle(async (req, res) => {
    const value = check(searchSchema, req.body),
      controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    const timeout = setTimeout(() => controller.abort(), 600000);
    try {
      res.json(await service.fullSearch(req.user, value.ids, value.parameters, controller.signal));
    } finally {
      clearTimeout(timeout);
      req.removeListener('aborted', cancel);
      res.removeListener('close', cancel);
    }
  }));
  router.post('/searches/:id/duplicates-xlsx', handle(async (req, res) => {
    if (Object.keys(req.body).length) throw Object.assign(new Error('Неизвестные параметры выгрузки.'), {
      status: 400
    });
    const result = await service.search(req.user, uuid(req.params.id));
    if (result.state !== 'complete') throw Object.assign(new Error('Поиск ещё не завершён.'), {
      status: 409
    });
    const comparisons = [...result.internal.results, ...result.master.results].flatMap(group => (group.exportMatches || group.matches).map(match => ({
      reference: group.reference,
      matched: match,
      algorithm: match.algorithm || result.parameters.comparisonAlgorithm || 'standard',
      matchedLoci: match.matchedLoci,
      details: match.details
    })));
    if (!comparisons.length) throw Object.assign(new Error('Нет найденных дубликатов для выгрузки.'), {
      status: 400
    });
    const {
      DuplicateExcelExportService
    } = require('../services/audit/duplicateExcelExportService');
    res.type('xlsx').attachment('Duplicates.xlsx').send(await new DuplicateExcelExportService().createWorkbookBuffer({
      comparisons,
      metadata: {
        importFormat: 'genetic',
        ignoredLoci: result.parameters.ignoredLoci || []
      }
    }));
  }));
  router.get('/searches/:id', handle(async (req, res) => res.json(await service.search(req.user, uuid(req.params.id)))));
  router.post('/publication-preview', handle(async (req, res) => {
    const value = check(Joi.object({
      ids
    }), req.body);
    res.json(await service.publicationPreview(req.user, value.ids));
  }));
  router.post('/publish', handle(async (req, res) => {
    const value = check(Joi.object({
      ids,
      searchRunId: Joi.string().guid().required(),
      existingTargets: Joi.object().pattern(/^[0-9a-f-]{36}$/i, Joi.string().guid())
    }), req.body);
    res.json(await service.publish(req.user, value.ids, value.searchRunId, value.existingTargets));
  }));
  router.post('/import-drafts', (req, res, next) => {
    try {
      require('../services/workspace/workspaceService').requireUpload(req.user);
      next();
    } catch (e) {
      next(e);
    }
  }, upload, handle(async (req, res) => {
    if (!req.files?.length || req.files.reduce((s, f) => s + f.size, 0) > 50 * 1024 * 1024) throw Object.assign(new Error('Выберите до 100 файлов, суммарно до 50 МиБ.'), {
      status: 400
    });
    res.json(await service.createDraft(req.user, req.files));
  }));
  router.get('/import-drafts/:id', handle(async (req, res) => {
    const d = await service.draft(req.user, uuid(req.params.id));
    res.json({
      id: d.id,
      revision: d.revision,
      rows: d.rows,
      committedAt: d.committed_at,
      resultIds: d.result_ids
    });
  }));
  router.patch('/import-drafts/:id/rows', handle(async (req, res) => {
    const value = check(Joi.object({
      revision,
      rows: Joi.array().max(10000).items(patch).required()
    }), req.body);
    res.json(await service.patchDraft(req.user, uuid(req.params.id), value.revision, value.rows));
  }));
  for (const op of ['validate', 'export', 'commit']) router.post('/import-drafts/:id/' + op, handle(async (req, res) => {
    const value = check(Joi.object({
        revision,
        ...(op === 'commit' ? {
          idempotencyKey: Joi.string().guid().required()
        } : {})
      }), req.body),
      id = uuid(req.params.id);
    if (op === 'validate') res.json(await service.validateDraft(req.user, id, value.revision));else if (op === 'export') {
      const draft = await service.draft(req.user, id);
      const names = [...new Set(draft.rows.filter(row => row.included).map(row => row.sourceFilename))];
      const filename = names.length === 1 && /\.txt$/i.test(names[0]) ? require('../utils/normalizedExcelLayout').geneMapperExportFilename(names[0]) : 'Генотипы.xlsx';
      workbookDownload(res, filename).send(await service.exportDraft(req.user, id, value.revision));
    } else res.json(await service.commitDraft(req.user, id, value.revision, value.idempotencyKey));
  }));
  router.use((e, req, res, next) => {
    const status = e.status || (String(e.code || '').startsWith('LIMIT_') ? 413 : ['23505', '42501'].includes(e.code) ? 409 : 500);
    res.status(status).json({
      message: status === 500 ? 'Не удалось выполнить операцию. Изменения не были записаны.' : e.status ? e.message : e.code === '23505' ? 'Объект с таким типом, годом и номером уже существует.' : 'Нужен актуальный полный поиск.',
      code: e.code || 'WORKSPACE_ERROR',
      ...(e.details ? {
        details: e.details
      } : {})
    });
  });
  return router;
};

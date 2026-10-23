const Joi = require('joi');
const { ProfileAccessService } = require('../security/profileAccessService');
const AccessPolicyService = require('../security/AccessPolicyService');

const parameters = Joi.object({
  taskId: Joi.string().guid().required(),
  minMatches: Joi.number().integer().min(1).max(500),
  ignoredLoci: Joi.array().max(500).items(Joi.string().trim().min(1).max(100)),
  comparisonAlgorithm: Joi.string().valid('standard', 'duplicate_v5', 'contamination'),
  useV5Algorithm: Joi.boolean(), useWorkers: Joi.boolean(),
  duplicateSettings: Joi.object({ minScore: Joi.number().min(0), minPercentage: Joi.number().min(0).max(100),
    minLoci: Joi.number().integer().min(1).max(500), locusWeights: Joi.object().pattern(/^.{1,100}$/, Joi.number().min(0).max(100)) })
}).unknown(true);

function validateSearchParameters(req, res, next) {
  if (parameters.validate(req.body, { convert: false }).error) return res.status(400).json({ success: false, error: 'Проверьте ID задачи и параметры сравнения.' });
  next();
}

async function getAnalysisTask(req, taskId) {
  const scope = await ProfileAccessService.getScope({ userId: req.user.id, activeDepartmentId: req.activeDepartmentId || req.user.department_id });
  const { rows } = await req.app.locals.pool.query(`SELECT t.id, t.department_id, t.assigned_to_user, d.organization_id
    FROM tasks t JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id
    WHERE t.id=$1 AND t.is_active=true AND d.is_active=true AND o.is_active=true`, [taskId]);
  if (!rows.length) throw Object.assign(new Error('Задача не найдена.'), { status: 404 });
  const task = rows[0];
  if (task.department_id !== scope.params[0] || task.organization_id !== scope.params[1] || !await AccessPolicyService.canManageTask(req.user.id, taskId)) {
    throw Object.assign(new Error('Задача недоступна в активном отделении.'), { status: 403 });
  }
  return task;
}

module.exports = { validateSearchParameters, getAnalysisTask };

const Joi = require('joi');

const userIdentityFields = {
  display_name: Joi.string().trim().max(150).pattern(/^[^\u0000-\u001f\u007f]+$/).allow('', null).optional(),
  email: Joi.string().trim().email().max(100).allow('', null).optional()
};
const identitySchema = Joi.object(userIdentityFields).unknown(true);

function normalizeUserIdentity(data) {
  const { value, error } = identitySchema.validate(data, { abortEarly: false });
  if (error) throw Object.assign(new Error('Проверьте Фамилию И.О. и адрес электронной почты.'), {
    status: 400, code: 'INVALID_USER_IDENTITY', details: error.details.map(item => ({ field: item.path.join('.'), message: item.message }))
  });
  for (const field of ['display_name', 'email']) if (value[field] === '') value[field] = null;
  return value;
}

function validateUserIdentity(req, res, next) {
  try { req.body = normalizeUserIdentity(req.body); next(); }
  catch (error) { res.status(400).json({ message: error.message, code: error.code, details: error.details }); }
}

module.exports = { userIdentityFields, normalizeUserIdentity, validateUserIdentity };

const { ProfileAccessService } = require('../security/profileAccessService');
const denied = () => Object.assign(new Error('Профиль недоступен в активном отделении.'), { status: 403 });
async function scopeFor(req) {
  return ProfileAccessService.getScope({ userId: req.user.id, activeDepartmentId: req.activeDepartmentId });
}
async function requireProfiles(req, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw Object.assign(new Error('Проверьте идентификаторы профилей (до 1000).'), { status: 400 });
  const scope = await scopeFor(req), unique = [...new Set(ids)];
  const { rows } = await req.app.locals.pool.query(`SELECT dp.id FROM dna_profiles dp WHERE ${scope.clause} AND dp.id=ANY($${scope.params.length+1}::uuid[])`, [...scope.params, unique]);
  if (rows.length !== unique.length) throw denied();
  return scope;
}
function logScope(scope, alias = 'l') {
  if (!scope?.params?.length || typeof scope.clause !== 'string') throw denied();
  return `${alias}.department_id=$1 AND EXISTS(SELECT 1 FROM dna_profiles dp WHERE dp.id=${alias}.reference_profile_id AND ${scope.clause})
    AND EXISTS(SELECT 1 FROM dna_profiles dp WHERE dp.id=${alias}.matched_profile_id AND ${scope.clause})`;
}
module.exports = { scopeFor, requireProfiles, logScope };

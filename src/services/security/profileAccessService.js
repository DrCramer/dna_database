const { AccessPolicyService, ProfileAccessError } = require('./AccessPolicyService');
class ProfileAccessService {
 static getScope(context) { return AccessPolicyService.getProfileScope(context); }
 static validateProfileAccess(context) { return AccessPolicyService.validateProfileAccess(context); }
}
module.exports = { ProfileAccessService, ProfileAccessError };

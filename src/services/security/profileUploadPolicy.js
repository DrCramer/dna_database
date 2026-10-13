const { AccessPolicyService, ProfileUploadAccessError } = require('./AccessPolicyService');
const assertProfileUploadAllowed = (...args) => AccessPolicyService.assertProfileUploadAllowed(...args);
module.exports = { assertProfileUploadAllowed, ProfileUploadAccessError };

// Совместимый импорт общих правил для frontend и backend.
const { UPLOAD_PERMISSION_FIELDS, getProfileUploadPermissions, validateUploadPermissionFields, getProfileUploadBlockReason } = require('./accessPolicyRules');
module.exports = { UPLOAD_PERMISSION_FIELDS, getProfileUploadPermissions, validateUploadPermissionFields, getProfileUploadBlockReason };

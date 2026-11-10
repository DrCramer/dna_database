// Preserve structured diagnostics through every upload/confirmation catch handler.
function profileUploadError(data, fallback = 'Не удалось загрузить файл. Повторите попытку.') {
  const error = new Error(data?.message || fallback);
  if (data?.code) error.code = data.code;
  if (data?.validation) error.validation = data.validation;
  const validationErrors = data?.validationErrors || data?.details?.validationErrors;
  if (Array.isArray(validationErrors)) {
    error.validationErrors = validationErrors;
    error.errorCount = validationErrors.length;
  }
  const duplicates = data?.internalDuplicates || data?.details?.internalDuplicates;
  if (Array.isArray(duplicates)) {
    error.internalDuplicates = duplicates;
    error.duplicateCount = duplicates.length;
  }
  return error;
}

module.exports = { profileUploadError };

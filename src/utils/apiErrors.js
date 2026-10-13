// Общий публичный контракт ошибок. Модуль не зависит от Express или БД.
const STATUS_CODES = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE' };
const TYPE_STATUS = { VALIDATION_ERROR: 400, DATA_ERROR: 422, PERMISSION_ERROR: 403,
  NETWORK_ERROR: 503, CALCULATION_ERROR: 500, CONFIGURATION_ERROR: 500, SYSTEM_ERROR: 500 };

function getErrorStatus(error) {
  const status = Number(error?.statusCode || error?.status || TYPE_STATUS[error?.type] || 500);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function normalizeApiErrorResponse(status, body, { requestId = null, production = true, timestamp = new Date().toISOString() } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : { message: typeof body === 'string' ? body : undefined };
  const message = status >= 500 && production ? 'Внутренняя ошибка сервера. Повторите попытку позже.'
    : input.message || (typeof input.error === 'string' ? input.error : input.error?.message) || 'Ошибка запроса.';
  const candidate = input.code || input.type || input.error?.code || input.error?.type;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(candidate)
    ? candidate : STATUS_CODES[status] || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
  // При 5xx в production исключаем весь произвольный payload, в том числе SQL,
  // стеки, пути, контекст расчётов и данные пользователя. Они остаются в логах.
  const output = status >= 500 && production ? {} : { ...input };
  for (const field of ['stack', 'cause', 'sql', 'query', 'context']) delete output[field];
  Object.assign(output, { success: false, message, code, status, requestId, timestamp });
  // Сохраняем тип старого поля error: существующие клиенты читают и строку,
  // и error.message. Новые клиенты всегда могут использовать верхние поля.
  if (typeof input.error === 'string') output.error = status >= 500 && production ? 'Internal server error' : input.error;
  else {
    const detail = status >= 500 && production ? {} : { ...input.error };
    for (const field of ['stack', 'cause', 'sql', 'query', 'context']) delete detail[field];
    output.error = { ...detail, message, code, status, requestId, timestamp };
  }
  return output;
}

function serializeApiError(error, options) {
  const status = getErrorStatus(error);
  return normalizeApiErrorResponse(status, { message: error?.message, code: error?.code || error?.type }, options);
}

module.exports = { getErrorStatus, normalizeApiErrorResponse, serializeApiError };

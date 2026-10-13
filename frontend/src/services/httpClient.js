// Общий транспорт клиентских API. Авторизация берётся из текущей сессии.
export function createHttpClient({ fetchImpl = (...args) => fetch(...args), storage = () => localStorage } = {}) {
  async function request(method, endpoint, body, options = {}) {
    // Клиент отправляет токен только на API этого приложения.
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
      throw new Error('Ожидается локальный путь API.');
    }
    const url = endpoint.startsWith('/api/') ? endpoint : `/api${endpoint}`;
    const headers = new Headers(options.headers);
    const saved = storage();
    const token = saved.getItem('token');
    let user;
    try { user = JSON.parse(saved.getItem('user') || 'null'); } catch { user = null; }
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const department = user?.active_department_id || user?.department_id;
    if (department && !headers.has('X-Active-Department-Id')) headers.set('X-Active-Department-Id', department);
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (isForm) headers.delete('Content-Type'); // Boundary устанавливает браузер.
    else if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const init = { method, headers, signal: options.signal };
    if (body !== undefined) init.body = isForm ? body : JSON.stringify(body);
    let response;
    try { response = await fetchImpl(url, init); }
    catch (error) { error.request = { method, url }; throw error; }
    const data = response.status === 204 ? null
      : response.ok && options.responseType === 'blob' ? await response.blob()
      : (response.headers.get('Content-Type') || '').includes('json') ? await response.json()
      : await response.text();
    const result = { data, status: response.status, headers: Object.fromEntries(response.headers.entries()) };
    if (!response.ok) {
      const error = new Error(data?.message || `Ошибка API: ${response.status}`);
      error.response = result;
      throw error;
    }
    return result;
  }
  return {
    get: (url, options) => request('GET', url, undefined, options),
    post: (url, data, options) => request('POST', url, data, options),
    put: (url, data, options) => request('PUT', url, data, options),
    delete: (url, options) => request('DELETE', url, undefined, options)
  };
}

export default createHttpClient();

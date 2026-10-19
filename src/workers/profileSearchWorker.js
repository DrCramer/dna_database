const { parentPort, workerData } = require('node:worker_threads');
const { compareTaskProfiles, compareDepartmentProfiles } = require('../services/profiles/taskComparisonService');

// В worker передаются только профили, уже отобранные маршрутом по правам доступа.
// Соединения с БД, секреты и HTTP-объекты сюда не передаются.
const compare = workerData.operation === 'department' ? compareDepartmentProfiles : compareTaskProfiles;
parentPort.postMessage(compare(workerData.input));

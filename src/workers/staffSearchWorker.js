const { parentPort, workerData } = require('node:worker_threads');
const { compareStaffProfiles } = require('../services/contamination/staffComparisonService');

compareStaffProfiles(workerData).then(result => parentPort.postMessage(result)).catch(error => {
  // A failed partition fails the whole search; no partial readiness/publication.
  setImmediate(() => { throw error; });
});

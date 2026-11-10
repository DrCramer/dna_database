const test = require('node:test'),
  assert = require('node:assert/strict'),
  {
    PassThrough
  } = require('node:stream');
const {
  boundedUploadStorage
} = require('../src/services/infrastructure/boundedUploadStorage');
function file(storage, req, chunks) {
  return new Promise(resolve => {
    const stream = new PassThrough();
    storage._handleFile(req, {
      stream
    }, (error, result) => resolve({
      error,
      result
    }));
    for (const chunk of chunks) stream.write(Buffer.from(chunk));
    stream.end();
  });
}
test('Multipart storage ограничивает сумму файлов до буферизации и сохраняет допустимое содержимое', async () => {
  const storage = boundedUploadStorage(7),
    req = {};
  assert.equal((await file(storage, req, ['ab', 'cd'])).result.buffer.toString(), 'abcd');
  const result = await file(storage, req, ['ef', 'gh']);
  assert.equal(result.error.status, 413);
  assert.equal(result.result, undefined);
});

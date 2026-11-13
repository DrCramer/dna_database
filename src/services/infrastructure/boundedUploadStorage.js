// Bounded across all files in one multipart request; buffers never grow to files × per-file limit.
function boundedUploadStorage(maxBytes = 50 * 1024 * 1024) {
  return {
    _handleFile(req, file, callback) {
      const chunks = [];
      let size = 0,
        complete = false;
      const finish = (error, result) => {
        if (!complete) {
          complete = true;
          callback(error, result);
        }
      };
      file.stream.on('data', chunk => {
        req.boundedUploadBytes = (req.boundedUploadBytes || 0) + chunk.length;
        if (req.boundedUploadBytes > maxBytes) {
          chunks.length = 0;
          finish(Object.assign(new Error('Общий размер файлов превышает 50 МиБ.'), {
            status: 413,
            code: 'FILES_TOO_LARGE'
          }));
        }
        if (!complete) {
          chunks.push(chunk);
          size += chunk.length;
        }
      });
      file.stream.on('end', () => finish(null, {
        buffer: Buffer.concat(chunks),
        size
      }));
      file.stream.on('error', error => finish(error));
    },
    _removeFile(req, file, callback) {
      delete file.buffer;
      callback(null);
    }
  };
}
module.exports = {
  boundedUploadStorage
};

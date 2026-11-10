// Multer/Busboy 1.x reads non-extended multipart filename parameters as Latin-1.
// Repair only a lossless UTF-8 byte sequence; do not reinterpret actual Unicode.
function decodeUploadFilename(value) {
  if (typeof value !== 'string' || !/[\u0080-\u00ff]/.test(value) || /[^\u0000-\u00ff]/.test(value)) return value;
  const bytes = Buffer.from(value, 'latin1');
  const decoded = bytes.toString('utf8');
  return !decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : value;
}
function normalizeStoredImportFilename(row) {
  if (row.provenance?.sourceFilenameDecoded) return row;
  const original = row.sourceFilename;
  const sourceFilename = decodeUploadFilename(original);
  return {
    ...row,
    sourceFilename,
    provenance: {
      ...row.provenance,
      sourceFilename: decodeUploadFilename(row.provenance?.sourceFilename || original),
      sourceFilenameDecoded: true,
      ...(sourceFilename !== original ? {
        originalUploadedFilename: original
      } : {})
    }
  };
}
module.exports = {
  decodeUploadFilename,
  normalizeStoredImportFilename
};

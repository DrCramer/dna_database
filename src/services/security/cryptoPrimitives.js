const crypto = require('node:crypto');

const ALGORITHMS = Object.freeze({
  'aes-256-cbc': Object.freeze({ keyLength: 32, ivLength: 16, algorithm: 'aes-256-cbc' }),
  'aes-256-gcm': Object.freeze({ keyLength: 32, ivLength: 12, algorithm: 'aes-256-gcm' })
});

function getAlgorithm(algorithm) {
  const config = Object.hasOwn(ALGORITHMS, algorithm) ? ALGORITHMS[algorithm] : null;
  if (!config) throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
  return config;
}

// Только криптографические операции. Формат хранения, пустые значения и
// публичные ошибки определяются адаптерами, чтобы прежние записи читались.
function encryptBytes(plaintext, key, algorithm = 'aes-256-cbc') {
  const config = getAlgorithm(algorithm);
  const iv = crypto.randomBytes(config.ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, data, authTag: algorithm === 'aes-256-gcm' ? cipher.getAuthTag() : null };
}

function decryptBytes({ algorithm = 'aes-256-cbc', iv, data, authTag }, key) {
  getAlgorithm(algorithm);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  if (algorithm === 'aes-256-gcm' && authTag) decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

module.exports = { ALGORITHMS, encryptBytes, decryptBytes };

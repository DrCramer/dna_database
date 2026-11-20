const {
  encryptBytes,
  decryptBytes
} = require('../security/cryptoPrimitives');
const key = () => require('../../config/security').securityConfig.encryptionKey;
function seal(value) {
  const x = encryptBytes(JSON.stringify(value), key(), 'aes-256-gcm');
  return JSON.stringify({
    algorithm: 'aes-256-gcm',
    iv: x.iv.toString('base64'),
    data: x.data.toString('base64'),
    authTag: x.authTag.toString('base64')
  });
}
function unseal(value) {
  const x = JSON.parse(value);
  return JSON.parse(decryptBytes({
    algorithm: x.algorithm,
    iv: Buffer.from(x.iv, 'base64'),
    data: Buffer.from(x.data, 'base64'),
    authTag: Buffer.from(x.authTag, 'base64')
  }, key()).toString('utf8'));
}
module.exports = {
  seal,
  unseal
};

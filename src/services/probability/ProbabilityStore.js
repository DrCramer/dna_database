const { randomUUID } = require('node:crypto');
const { encryptBytes, decryptBytes } = require('../security/cryptoPrimitives');
// The key is injected. No secrets or genotype snapshots are logged.
class ProbabilityStore {
  constructor(query, key) { this.query = query; this.key = key; }
  seal(value) {
    const encrypted = encryptBytes(JSON.stringify(value), this.key, 'aes-256-gcm');
    return JSON.stringify({ algorithm: 'aes-256-gcm', iv: encrypted.iv.toString('base64'), data: encrypted.data.toString('base64'), authTag: encrypted.authTag.toString('base64') });
  }
  open(value) {
    const p = JSON.parse(value);
    if (p.algorithm !== 'aes-256-gcm') throw new Error('Unsupported snapshot encryption');
    return JSON.parse(decryptBytes({ algorithm: p.algorithm, iv: Buffer.from(p.iv, 'base64'), data: Buffer.from(p.data, 'base64'), authTag: Buffer.from(p.authTag, 'base64') }, this.key).toString('utf8'));
  }
  async save(context, calculation) {
    const id = randomUUID();
    await this.query(`INSERT INTO probability_calculations
      (id,user_id,department_id,organization_id,mode,formula_version,reference_version,snapshot_encrypted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, context.userId, context.departmentId, context.organizationId, calculation.mode,
      calculation.formulaVersion, calculation.reference.id, this.seal(calculation)]);
    return { id, ...calculation };
  }
  async list(context) {
    return (await this.query(`SELECT id,mode,formula_version,reference_version,created_at FROM probability_calculations
      WHERE user_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND organization_id=$3 ORDER BY created_at DESC LIMIT 100`,
    [context.userId, context.departmentId, context.organizationId])).rows;
  }
  async get(context, id) {
    const { rows } = await this.query(`SELECT id,snapshot_encrypted FROM probability_calculations
      WHERE id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR department_id=$3) AND organization_id=$4`, [id, context.userId, context.departmentId, context.organizationId]);
    return rows[0] ? { id: rows[0].id, ...this.open(rows[0].snapshot_encrypted) } : null;
  }
}
module.exports = { ProbabilityStore };

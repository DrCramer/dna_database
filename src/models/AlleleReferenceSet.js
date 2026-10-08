const { query, transaction } = require('../config/database');
const { validateReferenceImport, ReferenceError } = require('../utils/alleleReferenceImport');
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const valueCache = new Map();
class AlleleReferenceSet {
  static toJSON(row) {
    return {
      id: row.id, name: row.name, type: row.type, manufacturer: row.manufacturer,
      kitName: row.kit_name, kitVersion: row.kit_version,
      sourceTitle: row.source_title, sourceUrl: row.source_url, sourceVersion: row.source_version,
      sourceDate: row.source_date, importedAt: row.imported_at, isActive: row.is_active,
      metadata: row.metadata, contentHash: row.content_hash, previousSetId: row.previous_set_id,
      valueCount: Number(row.value_count || 0), loci: row.loci || []
    };
  }
  static async list(scope, includeInactive = false) {
    const result = await query(`SELECT s.*, count(v.id)::int AS value_count,
      COALESCE(array_agg(DISTINCT v.locus_name ORDER BY v.locus_name) FILTER (WHERE v.id IS NOT NULL), '{}') AS loci
      FROM allele_reference_sets s LEFT JOIN allele_reference_values v ON v.reference_set_id=s.id
      WHERE s.organization_id=$1 AND s.department_id=$2 ${includeInactive ? '' : 'AND s.is_active=true'}
      GROUP BY s.id ORDER BY s.name, s.imported_at DESC`, [scope.organizationId, scope.departmentId]);
    return result.rows.map(this.toJSON);
  }
  static async find(id, scope) {
    if (!uuid.test(id || '')) throw new ReferenceError('Некорректный идентификатор справочника.');
    const row = (await query('SELECT * FROM allele_reference_sets WHERE id=$1 AND organization_id=$2 AND department_id=$3', [id, scope.organizationId, scope.departmentId])).rows[0];
    if (!row) throw new ReferenceError('Справочник недоступен в активном отделении.', 404, 'REFERENCE_NOT_FOUND');
    return this.toJSON(row);
  }
  static async values(sets) {
    // Содержимое версии неизменно. Активность и связи перечитываются для каждого запроса.
    const missing = sets.filter(set => !valueCache.has(`${set.id}:${set.contentHash}`));
    const rows = missing.length ? (await query('SELECT reference_set_id, locus_name, allele, classification, metadata FROM allele_reference_values WHERE reference_set_id=ANY($1::uuid[]) ORDER BY locus_name, allele', [missing.map(set => set.id)])).rows : [];
    const loaded = new Map(missing.map(set => [set.id, []]));
    for (const row of rows) loaded.get(row.reference_set_id).push({ locus: row.locus_name, allele: row.allele, classification: row.classification, metadata: row.metadata });
    const result = sets.map(set => ({ ...set, values: valueCache.get(`${set.id}:${set.contentHash}`) || loaded.get(set.id) || [] }));
    for (const set of result) {
      const key = `${set.id}:${set.contentHash}`;
      if (!valueCache.has(key)) {
        if (valueCache.size >= 32) valueCache.delete(valueCache.keys().next().value);
        valueCache.set(key, set.values);
      }
    }
    return result;
  }
  static invalidateCache(id) {
    for (const key of valueCache.keys()) if (!id || key.startsWith(`${id}:`)) valueCache.delete(key);
  }
  static async create(data, scope, userId) {
    const set = validateReferenceImport(data);
    if (set.previousSetId) {
      const previous = await this.find(set.previousSetId, scope);
      if (previous.name !== set.name || previous.type !== set.type) throw new ReferenceError('Новая версия должна сохранять название и тип предыдущего справочника.');
    }
    return transaction(async client => {
      const row = (await client.query(`INSERT INTO allele_reference_sets
        (organization_id,department_id,name,type,manufacturer,kit_name,kit_version,source_title,source_url,source_version,source_date,metadata,content_hash,created_by,previous_set_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [scope.organizationId, scope.departmentId, set.name, set.type, set.manufacturer, set.kitName, set.kitVersion, set.sourceTitle, set.sourceUrl, set.sourceVersion, set.sourceDate, set.metadata, set.contentHash, userId, set.previousSetId])).rows[0];
      await client.query(`INSERT INTO allele_reference_values (reference_set_id,locus_name,allele,classification,metadata)
        SELECT $1, v.locus, v.allele, v.classification, v.metadata FROM jsonb_to_recordset($2::jsonb)
        AS v(locus text, allele text, classification text, metadata jsonb)`, [row.id, JSON.stringify(set.values)]);
      return { ...this.toJSON(row), valueCount: set.values.length, loci: [...new Set(set.values.map(value => value.locus))] };
    });
  }
  static async setActive(id, active, scope) {
    await this.find(id, scope);
    if (typeof active !== 'boolean') throw new ReferenceError('Активность должна быть логическим значением.');
    const row = (await query('UPDATE allele_reference_sets SET is_active=$4 WHERE id=$1 AND organization_id=$2 AND department_id=$3 RETURNING *', [id, scope.organizationId, scope.departmentId, active])).rows[0];
    this.invalidateCache(id);
    return this.toJSON(row);
  }
  static async compare(id, otherId, scope) {
    const sets = await this.values([await this.find(id, scope), await this.find(otherId, scope)]);
    const index = values => new Map(values.map(value => [`${value.locus}:${value.allele}`, value]));
    const before = index(sets[0].values), after = index(sets[1].values);
    return { before: { id, version: sets[0].sourceVersion }, after: { id: otherId, version: sets[1].sourceVersion },
      added: [...after].filter(([key]) => !before.has(key)).map(([, value]) => value),
      removed: [...before].filter(([key]) => !after.has(key)).map(([, value]) => value),
      changed: [...after].filter(([key, value]) => before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(value)).map(([key, value]) => ({ before: before.get(key), after: value })) };
  }
}
module.exports = { AlleleReferenceSet };

const {
  createHash
} = require('node:crypto');
const JSZip = require('jszip');
const fs = require('node:fs');
const path = require('node:path');
const {
  Readable
} = require('node:stream');
const {
  pool
} = require('../../config/database');
const {
  createImportWorkbook
} = require('../../utils/importWorkbook');
const {
  FORMAT,
  hasGenotype,
  stableJSON
} = require('../../utils/objectImportV2');
const {
  decodeMasterRow
} = require('./masterArrayExcelExportService');
const {
  decryptBytes
} = require('../security/cryptoPrimitives');
const fail = (message, status = 400) => Object.assign(new Error(message), {
  status
});
const SOURCES = ['master', 'user', 'staff'];
function authorize(user) {
  if (!['admin', 'system_administrator'].includes(user.role) || !user.organization_id) throw fail('Нужны права администратора и организационный контекст.', 403);
}
// to_jsonb permits the read-only exporter to run both before and after migration 037.
const SOURCE_SQL = `SELECT CASE WHEN p.profile_type='master' THEN 'master' ELSE 'user' END::text source,p.id,p.year,p.department_id,p.organization_id,p.is_active,to_jsonb(p) record,d.name department_name
 FROM dna_profiles p LEFT JOIN departments d ON d.id=p.department_id
 UNION ALL SELECT 'master',p.id,p.year,ma.department_id,COALESCE(NULLIF(to_jsonb(p)->>'organization_id','')::uuid,NULLIF(to_jsonb(ma)->>'organization_id','')::uuid,d.organization_id),p.is_active,to_jsonb(p),d.name
 FROM master_array_profiles p LEFT JOIN master_arrays ma ON ma.id=p.master_array_id LEFT JOIN departments d ON d.id=ma.department_id
 UNION ALL SELECT 'staff',s.id,NULLIF(to_jsonb(s)->>'year','')::int,NULLIF(to_jsonb(s)->>'department_id','')::uuid,
 COALESCE(NULLIF(to_jsonb(s)->>'organization_id','')::uuid,u.organization_id),s.is_active,to_jsonb(s),d.name
 FROM staff_profiles s LEFT JOIN users u ON u.id=s.created_by LEFT JOIN departments d ON d.id=NULLIF(to_jsonb(s)->>'department_id','')::uuid`;
function filterSQL(user, filters) {
  authorize(user);
  const params = [user.organization_id, filters.sources, filters.years.filter(x => x !== null), filters.departments.filter(x => x !== null), filters.types.filter(x => x !== null)];
  const conditions = ['organization_id=$1', 'source=ANY($2::text[])', `(year=ANY($3::int[])${filters.years.includes(null) ? ' OR year IS NULL' : ''})`, `(department_id=ANY($4::uuid[])${filters.departments.includes(null) ? ' OR department_id IS NULL' : ''})`, `(COALESCE(record->>'expertise_type',CASE WHEN source='staff' THEN 'staff' END)=ANY($5::text[])${filters.types.includes(null) ? " OR (source<>'staff' AND record->>'expertise_type' IS NULL)" : ''})`];
  if (!filters.includeInactive) conditions.push('is_active=true');
  // Encrypted fields are authoritative; empty filtering is evaluated after decryption.
  if (filters.objectQuery) {
    params.push(`%${filters.objectQuery.replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(`COALESCE(record->>'internal_number',record->>'registration_number',record->>'staff_id','') ILIKE $${params.length} ESCAPE '\\'`);
  }
  return {
    text: `WITH sources AS (${SOURCE_SQL}) SELECT * FROM sources WHERE ${conditions.join(' AND ')} ORDER BY source,id`,
    params
  };
}
function decryptRecord(record, source) {
  if (source === 'master') return decodeMasterRow(record);
  const decoded = {
    ...record
  };
  for (const field of ['str_data', 'sample_name', 'notes']) if (record[field + '_encrypted']) {
    const encrypted = JSON.parse(record[field + '_encrypted']);
    const plain = decryptBytes({
      algorithm: encrypted.algorithm,
      iv: Buffer.from(encrypted.iv, 'base64'),
      data: Buffer.from(encrypted.data, 'base64'),
      authTag: encrypted.authTag ? Buffer.from(encrypted.authTag, 'base64') : null
    }, require('../../config/security').securityConfig.encryptionKey).toString('utf8');
    decoded[field] = field === 'str_data' ? JSON.parse(plain) : plain;
  }
  return decoded;
}
function exportRow(raw) {
  const p = decryptRecord(raw.record, raw.source);
  let data = p.str_data;
  if (typeof data === 'string') data = JSON.parse(data);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('Некорректная структура сохранённого генотипа. Выгрузка остановлена без пропуска записей.', 409);
  const strData = {};
  for (const [locus, value] of Object.entries(data)) {
    const alleles = Array.isArray(value) ? value : value && typeof value === 'object' && Object.hasOwn(value, 'allele1') ? [value.allele1, value.allele2].filter(x => x != null && x !== '') : value == null || value === '' ? [] : String(value).split(',');
    strData[locus] = alleles.map(String);
  }
  const staff = raw.source === 'staff';
  // Legacy staff_id can be an old name slug. Never pretend it is a verified registration number.
  const registration = p.registration_number || (staff && /^\d+-G$/i.test(p.staff_id || '') ? p.staff_id : '');
  return {
    objectNumber: staff ? registration : p.internal_number || '',
    year: raw.year,
    expertiseType: p.expertise_type || (staff ? 'staff' : null),
    fullName: staff || p.expertise_type === 'staff' ? p.full_name || '' : '',
    comment: p.comment ?? p.expert_comment ?? '',
    strData,
    provenance: {
      table: raw.source === 'master' ? 'master_array_profiles' : staff ? 'staff_profiles' : 'dna_profiles',
      id: raw.id,
      departmentId: raw.department_id,
      departmentName: raw.department_name,
      sampleName: p.sample_name ?? '',
      importNumber: p.import_number ?? '',
      sourceObjectNumber: staff ? p.staff_id : p.internal_number,
      legacy: Object.fromEntries(Object.entries(p).filter(([key]) => !key.endsWith('_encrypted') && !['str_data', 'password_hash'].includes(key)))
    }
  };
}
class LegacyMigrationExportService {
  constructor(databasePool = pool) {
    this.pool = databasePool;
  }
  async options(user) {
    authorize(user);
    const {
      rows
    } = await this.pool.query(`WITH sources AS (${SOURCE_SQL}) SELECT source,year,department_id,department_name,
      COALESCE(record->>'expertise_type',CASE WHEN source='staff' THEN 'staff' END) expertise_type,count(*)::int count
      FROM sources WHERE organization_id=$1 GROUP BY 1,2,3,4,5 ORDER BY source,year NULLS LAST`, [user.organization_id]);
    return {
      groups: rows,
      sources: SOURCES
    };
  }
  async inspect(user, filters, download = false, {
    asStream = false,
    signal
  } = {}) {
    const selection = filterSQL(user, filters),
      client = await this.pool.connect();
    const stats = {
      total: 0,
      empty: 0,
      missingYear: 0,
      unclassified: 0,
      missingRegistration: 0,
      sources: {},
      years: {},
      departments: {}
    };
    const digest = createHash('sha256'),
      parts = [],
      rows = [];
    let cells = 0,
      directory,
      outputStream;
    const inputStreams = [];
    const cleanup = async () => {
      outputStream?.destroy();
      inputStreams.forEach(stream => stream.destroy());
      if (directory) await fs.promises.rm(directory, {
        recursive: true,
        force: true
      });
    };
    const flush = async () => {
      if (!rows.length) return;
      const loci = [...new Set(rows.flatMap(row => Object.keys(row.strData)))];
      const buffer = createImportWorkbook({
        profiles: rows,
        loci,
        sourceFormat: FORMAT,
        hideEmptyLoci: true
      });
      if (directory) {
        const file = path.join(directory, `part-${parts.length + 1}.xlsx`);
        await fs.promises.writeFile(file, buffer, {
          mode: 0o600
        });
        parts.push(file);
      } else parts.push(buffer);
      rows.length = 0;
      cells = 0;
    };
    try {
      if (download && asStream) {
        const root = process.env.EXPORT_DIR || path.resolve(process.cwd(), process.env.NODE_ENV === 'production' ? 'exports' : 'runtime/exports');
        await fs.promises.mkdir(root, {
          recursive: true
        });
        directory = await fs.promises.mkdtemp(path.join(root, 'migration-'));
        await fs.promises.chmod(directory, 0o700);
      }
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query('SET LOCAL statement_timeout=60000');
      await client.query(`DECLARE migration_export NO SCROLL CURSOR FOR ${selection.text}`, selection.params);
      while (true) {
        if (signal?.aborted) throw fail('Выгрузка отменена.', 499);
        const batch = await client.query('FETCH FORWARD 500 FROM migration_export');
        if (!batch.rows.length) break;
        for (const raw of batch.rows) {
          const row = exportRow(raw),
            empty = !hasGenotype(row.strData);
          if (!filters.includeEmpty && empty) continue;
          stats.total++;
          if (empty) stats.empty++;
          if (row.year == null) stats.missingYear++;
          if (!row.expertiseType) stats.unclassified++;
          if (raw.source === 'staff' && !row.objectNumber) stats.missingRegistration++;
          for (const [group, key] of [['sources', raw.source], ['years', row.year ?? 'null'], ['departments', raw.department_id ?? 'null']]) stats[group][key] = (stats[group][key] || 0) + 1;
          digest.update(stableJSON([raw.source, raw.id, row]));
          if (download) {
            const size = Object.keys(row.strData).length + 14;
            if (rows.length >= 10000 || rows.length && cells + size > 500000) await flush();
            rows.push(row);
            cells += size;
          }
        }
      }
      if (download) await flush();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      await cleanup();
      throw error;
    } finally {
      client.release();
    }
    stats.fingerprint = digest.digest('hex');
    if (filters.previewFingerprint && stats.fingerprint !== filters.previewFingerprint) {
      await cleanup();
      throw fail('Выборка изменилась. Повторите предварительный просмотр.', 409);
    }
    if (!download) return stats;
    if (!stats.total) {
      await cleanup();
      throw fail('Нет выбранных записей.');
    }
    const yearValues = Object.keys(stats.years).filter(x => x !== 'null').sort();
    const years = yearValues.length > 1 ? yearValues[0] + '-' + yearValues[yearValues.length - 1] : yearValues[0];
    const filename = `Генотипы_${years || 'без-года'}_${new Date().toISOString().slice(0, 10)}`;
    if (parts.length === 1) {
      if (asStream) {
        outputStream = fs.createReadStream(parts[0]);
        return {
          stats,
          stream: outputStream,
          cleanup,
          filename: filename + '.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
      }
      return {
        stats,
        buffer: parts[0],
        filename: filename + '.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
    }
    const zip = new JSZip();
    parts.forEach((part, i) => {
      const stream = asStream ? Readable.from(async function* () {
        for await (const chunk of fs.createReadStream(part)) yield chunk;
      }()) : part;
      if (asStream) inputStreams.push(stream);
      zip.file(`${filename}_часть-${i + 1}.xlsx`, stream);
    });
    zip.file('Состав.json', JSON.stringify({
      format: FORMAT,
      ...stats,
      parts: parts.length
    }, null, 2));
    if (asStream) {
      const zipStream = zip.generateNodeStream({
        streamFiles: true,
        compression: 'STORE'
      });
      inputStreams.push(zipStream);
      outputStream = new Readable().wrap(zipStream);
      return {
        stats,
        stream: outputStream,
        cleanup,
        filename: filename + '.zip',
        mime: 'application/zip'
      };
    }
    return {
      stats,
      buffer: await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'STORE'
      }),
      filename: filename + '.zip',
      mime: 'application/zip'
    };
  }
}
module.exports = {
  LegacyMigrationExportService,
  filterSQL,
  exportRow,
  SOURCE_SQL
};

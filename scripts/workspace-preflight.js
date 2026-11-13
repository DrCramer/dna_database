#!/usr/bin/env node
// Aggregate-only, read-only preflight. Never prints connection strings or profiles.
require('dotenv').config();
const { Pool } = require('pg');
async function preflight(connectionString = process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString }), client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const results = {};
    results.server = (await client.query('SHOW server_version')).rows[0].server_version;
    results.profiles = (await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE year IS NULL)::int without_year,
      count(*) FILTER(WHERE department_id IS NULL)::int without_department,count(*) FILTER(WHERE organization_id IS NULL)::int without_organization,
      count(*) FILTER(WHERE str_data='{}'::jsonb)::int empty FROM dna_profiles`)).rows[0];
    results.master = (await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE p.year IS NULL)::int without_year,
      count(*) FILTER(WHERE d.organization_id IS NULL)::int without_organization FROM master_array_profiles p LEFT JOIN master_arrays ma ON ma.id=p.master_array_id LEFT JOIN departments d ON d.id=ma.department_id`)).rows[0];
    results.staff = (await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE u.organization_id IS NULL)::int without_owner_organization,
      count(*) FILTER(WHERE NULLIF(to_jsonb(s)->>'registration_number','') IS NULL)::int without_registration,
      count(*) FILTER(WHERE NULLIF(to_jsonb(s)->>'year','') IS NULL)::int without_year FROM staff_profiles s LEFT JOIN users u ON u.id=s.created_by`)).rows[0];
    results.groups = (await client.query('SELECT year,department_id,count(*)::int count FROM dna_profiles GROUP BY year,department_id ORDER BY year NULLS LAST,department_id')).rows;
    results.oldIdentityConflicts = (await client.query(`SELECT count(*)::int count FROM (SELECT organization_id,department_id,user_id,year,lower(btrim(internal_number)) FROM dna_profiles WHERE is_active=true GROUP BY 1,2,3,4,5 HAVING count(*)>1) duplicates`)).rows[0].count;
    await client.query('COMMIT');return results;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await pool.end(); }
}
if (require.main === module) preflight().then(result => console.log(JSON.stringify(result,null,2))).catch(error => { console.error('Preflight failed:',error.code||'DATABASE_ERROR');process.exitCode=1; });
module.exports={preflight};

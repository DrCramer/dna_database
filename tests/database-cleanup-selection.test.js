const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../src/services/infrastructure/genotypeCleanupPlan');

test('Cleanup categories require an explicit, nonempty allowlisted selection', () => {
  for (const input of [undefined, [], ['users'], ['personal', 'personal'], 'personal', ['results', 'invalid']]) {
    assert.throws(() => plan.categories(input), { status: 400 });
  }
  assert.deepEqual(plan.categories(['results', 'personal']), ['personal', 'results']);
});

test('Results-only cleanup never changes genotype tables or probability snapshots', () => {
  const spec = plan.operations(['results']);
  assert.equal(spec.ops.some(op => ['dna_profiles', 'master_array_profiles', 'staff_profiles', 'workspace_import_drafts', 'probability_calculations'].includes(op.table)), false);
  assert.ok(spec.ops.some(op => op.table === 'workspace_search_runs' && op.action === 'reset'));
});

test('Every profile selection clears dependent results and detaches unselected copies', () => {
  const personal = plan.operations(['personal']);
  assert.equal(personal.ops.filter(op => op.action === 'unlink').length, 2);
  assert.ok(personal.ops.some(op => op.table === 'dna_profiles' && op.where === "COALESCE(profile_type,'user') IN ('user')"));
  for (const selection of [['personal'], ['master'], ['staff']]) {
    const spec = plan.operations(selection);
    assert.ok(spec.ops.some(op => op.table === 'match_results'));
    assert.ok(spec.ops.some(op => op.table === 'workspace_search_jobs'));
    assert.equal(spec.ops.some(op => op.table === 'probability_calculations'), false);
    assert.ok(spec.ops.every(op => !op.sql.includes('CASCADE') && !op.sql.includes('TRUNCATE')));
  }
});


test('User scope is explicit, validated and cannot include shared arrays', () => {
  const userId = 'a1111111-1111-4111-8111-111111111111';
  assert.deepEqual(plan.personalScope(null, ['personal']), {mode:'all'});
  assert.deepEqual(plan.personalScope({mode:'user',userId}, ['personal']), {mode:'user',userId});
  for (const scope of [{mode:'user'}, {mode:'user',userId:'invalid'}, {mode:'all',userId}, {mode:'unknown'}, {mode:'user',userId,extra:true}]) {
    assert.throws(() => plan.personalScope(scope, ['personal']), {status:400});
  }
  assert.throws(() => plan.personalScope({mode:'user',userId}, ['personal','master']), {status:400});
  assert.throws(() => plan.personalScope({mode:'user',userId}, ['results']), {status:400});
  const spec = plan.operations(['personal'], {id:userId,organization_id:'a2222222-2222-4222-8222-222222222222'});
  assert.ok(spec.ops.find(op => op.table === 'dna_profiles').where.includes('user_id=$1'));
  assert.ok(spec.ops.find(op => op.table === 'workspace_search_runs').where.includes('owner_id=$1'));
  assert.ok(spec.ops.find(op => op.table === 'task_results').where.includes('user_id=$1'));
  assert.ok(spec.ops.every(op => !op.sql.includes(userId)));
  assert.deepEqual(plan.parameters('SELECT $1', ['a','b']), ['a']);
  assert.deepEqual(plan.parameters('SELECT 1', ['a','b']), []);
});

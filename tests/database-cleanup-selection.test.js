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

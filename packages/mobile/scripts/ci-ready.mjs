// The Frontend ready gate, runnable locally with the same `needs` JSON as Actions.
// Missing/unknown selector outputs must never turn an incomplete run green.
const needs = JSON.parse(process.env.RESULTS ?? '{}');
const selected = needs.select?.outputs;
for (const key of ['full', 'ui', 'game', 'accounts']) {
  if (!['true', 'false'].includes(selected?.[key])) {
    throw new Error(`Missing or invalid selection: ${key}`);
  }
}
if (
  selected.full === 'true' &&
  ['ui', 'game', 'accounts'].some((key) => selected[key] !== 'true')
) {
  throw new Error('A full run must select every regression layer');
}

const required = {
  select: true,
  quality: true,
  'integration-backend': selected.game === 'true' || selected.accounts === 'true',
  'ui-grammar': selected.ui === 'true',
  'game-e2e': selected.game === 'true',
  // This aggregate also validates that unselected account shards were really skipped.
  'account-e2e': true,
};
for (const [job, mustRun] of Object.entries(required)) {
  const result = needs[job]?.result;
  console.log(`${job}: ${result ?? 'missing'} (required: ${mustRun})`);
  if (result !== 'success' && !(result === 'skipped' && !mustRun)) {
    throw new Error(`${job} did not pass${mustRun ? ' (required)' : ''}`);
  }
}
console.log(
  `Frontend ready${selected.full === 'true' ? ' (full)' : ''}: all selected checks passed`
);

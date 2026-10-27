import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function compareRuns(runPaths, outputPath) {
  if (runPaths.length < 2) throw new Error('compare requires at least two run directories');
  const runs = await Promise.all(runPaths.map(loadRun));
  const datasetIds = new Set(runs.map((run) => run.results.datasetId));
  if (datasetIds.size !== 1) throw new Error('all compared runs must use the same dataset');
  const datasetHashes = new Set(runs.map((run) => run.manifest.files?.dataset?.sha256));
  if (datasetHashes.has(null) || datasetHashes.has(undefined)
    || [...datasetHashes].some((hash) => !/^[a-f0-9]{64}$/u.test(hash))) {
    throw new Error('all compared runs must record a valid dataset SHA-256');
  }
  if (datasetHashes.size !== 1) {
    throw new Error('all compared runs must use byte-identical datasets; use a different dataset version for changed fixtures');
  }
  assertMatchingQueryIds(runs);
  const reference = runs[0];
  const comparison = {
    schemaVersion: 1,
    datasetId: reference.results.datasetId,
    referenceBaseline: reference.results.baseline,
    runs: runs.map((run) => summarizeRun(run, reference)),
    queryChanges: queryChanges(runs),
  };
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  return comparison;
}

async function loadRun(runPath) {
  const directory = path.resolve(runPath);
  const [manifest, results] = await Promise.all([
    readJson(path.join(directory, 'manifest.json')),
    readJson(path.join(directory, 'results.json')),
  ]);
  if (manifest.baseline !== results.baseline) throw new Error(`baseline mismatch in ${directory}`);
  if (manifest.status !== 'succeeded' || results.status !== 'succeeded') {
    throw new Error(`cannot compare failed or incomplete run: ${directory}`);
  }
  return { directory, manifest, results };
}

function assertMatchingQueryIds(runs) {
  const expected = queryIds(runs[0]);
  for (const run of runs.slice(1)) {
    const actual = queryIds(run);
    if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
      throw new Error(`all compared runs must contain the same query IDs: ${run.directory}`);
    }
  }
}

function queryIds(run) {
  const ids = run.results.queries.map((query) => query.id);
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new Error(`run contains missing or duplicate query IDs: ${run.directory}`);
  }
  return [...ids].sort();
}

function summarizeRun(run, reference) {
  const metrics = run.results.metrics;
  const referenceMetrics = reference.results.metrics;
  return {
    directory: run.directory,
    baseline: run.results.baseline,
    judgedRecall: metrics.judgedRecall,
    judgedRecallDelta: nullableDelta(metrics.judgedRecall.value, referenceMetrics.judgedRecall.value),
    negativeViolationCount: metrics.negativeViolations.length,
    negativeViolationDelta: metrics.negativeViolations.length - referenceMetrics.negativeViolations.length,
    expectZeroViolationCount: metrics.expectZeroViolations.length,
    rankingPassed: metrics.ranking.filter((entry) => entry.pass).length,
    rankingTotal: metrics.ranking.length,
    timing: metrics.timing,
  };
}

function queryChanges(runs) {
  const reference = new Map(runs[0].results.queries.map((query) => [query.id, query]));
  return runs.slice(1).flatMap((run) => run.results.queries.flatMap((query) => {
    const before = reference.get(query.id);
    if (!before) return [{ baseline: run.results.baseline, queryId: query.id, kind: 'added-query' }];
    const addedIds = query.allIds.filter((id) => !before.allIds.includes(id));
    const removedIds = before.allIds.filter((id) => !query.allIds.includes(id));
    const rankChanges = query.allIds.flatMap((id, rank) => {
      const previousRank = before.allIds.indexOf(id);
      return previousRank >= 0 && previousRank !== rank ? [{ id, previousRank, rank }] : [];
    });
    if (addedIds.length === 0 && removedIds.length === 0 && rankChanges.length === 0) return [];
    return [{ baseline: run.results.baseline, queryId: query.id, addedIds, removedIds, rankChanges }];
  }));
}

function nullableDelta(value, reference) {
  return value === null || reference === null ? null : value - reference;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

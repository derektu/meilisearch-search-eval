import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareRuns } from '../src/compare.mjs';

test('compare rejects the same dataset ID when fixture bytes differ', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-eval-compare-test-'));
  try {
    const first = await writeRun(temporary, 'first', { datasetHash: 'a'.repeat(64) });
    const second = await writeRun(temporary, 'second', { datasetHash: 'b'.repeat(64) });
    await assert.rejects(
      compareRuns([first, second], path.join(temporary, 'comparison.json')),
      /byte-identical datasets/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('compare rejects failed runs and mismatched query sets', async (t) => {
  await t.test('failed run', async () => {
    await withRuns(async (temporary, first) => {
      const failed = await writeRun(temporary, 'failed', { status: 'failed' });
      await assert.rejects(
        compareRuns([first, failed], path.join(temporary, 'comparison.json')),
        /failed or incomplete/u,
      );
    });
  });
  await t.test('missing query', async () => {
    await withRuns(async (temporary, first) => {
      const incomplete = await writeRun(temporary, 'incomplete', { queryIds: ['q1'] });
      await assert.rejects(
        compareRuns([first, incomplete], path.join(temporary, 'comparison.json')),
        /same query IDs/u,
      );
    });
  });
});

async function withRuns(callback) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-eval-compare-test-'));
  try {
    const first = await writeRun(temporary, 'first');
    await callback(temporary, first);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function writeRun(root, name, options = {}) {
  const directory = path.join(root, name);
  await mkdir(directory);
  const status = options.status ?? 'succeeded';
  const baseline = name;
  const queryIds = options.queryIds ?? ['q1', 'q2'];
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    status,
    baseline,
    files: { dataset: { sha256: options.datasetHash ?? 'a'.repeat(64) } },
  }));
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({
    status,
    baseline,
    datasetId: 'fixed-id',
    metrics: metrics(),
    queries: queryIds.map((id) => ({ id, allIds: [] })),
  }));
  return directory;
}

function metrics() {
  return {
    judgedRecall: { found: 0, total: 0, value: null },
    negativeViolations: [],
    expectZeroViolations: [],
    ranking: [],
    timing: {},
  };
}

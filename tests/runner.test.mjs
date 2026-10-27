import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { loadBaseline } from '../src/baseline.mjs';
import { evaluateResults } from '../src/evaluate.mjs';
import { buildFragmentIndex, groupsForChunks, queryChunks } from '../src/fragments.mjs';
import { normalizeSearchText, normalizeSearchTextWithMap } from '../src/normalize.mjs';
import { runEvaluation } from '../src/runner.mjs';

const execFileAsync = promisify(execFile);

test('CLI help is available without engine or dataset setup', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['src/cli.mjs', '--help'], {
    cwd: path.resolve(import.meta.dirname, '..'),
  });
  assert.match(stdout, /node src\/cli\.mjs run/u);
  assert.equal(stderr, '');
});

test('normalization matches ticket 162 and maps converted text to raw text', () => {
  assert.equal(normalizeSearchText(' ＡＢＣ\u3000台积电\u0085'), 'abc 台積電');
  const projection = normalizeSearchTextWithMap('😀半导体');
  assert.equal(projection.text, '😀半導體');
  const start = Buffer.byteLength('😀半');
  assert.deepEqual(projection.rawRange(start, Buffer.byteLength('導體')), { start: 3, end: 5 });
});

test('baseline files are the strategy source of truth', async () => {
  assert.equal((await loadBaseline('B0')).config.normalization, false);
  assert.equal((await loadBaseline('B2')).config.engine.env.SEARCH_EVAL_DISABLE_SECONDARY_SPLIT, '0');
  assert.equal((await loadBaseline('B3')).config.engine.env.SEARCH_EVAL_DISABLE_SECONDARY_SPLIT, '1');
  assert.equal((await loadBaseline('B4')).config.fragmentReference, true);
  await assert.rejects(loadBaseline('gold-dependent'), /baseline must be one of/u);
});

test('fragment reference coalesces adjacent Han singletons and requires a contiguous field match', () => {
  const chunks = queryChunks('半導');
  const groups = groupsForChunks(chunks, new Map([['半導', [
    { word: '半', startByte: 0, endByte: 3 },
    { word: '導', startByte: 3, endByte: 6 },
  ]]]));
  assert.deepEqual(groups, ['半導']);
  const index = buildFragmentIndex([
    document('good', '半導體製程'),
    document('bad', '半年計畫與導師制度'),
    document('stock', '增加個股研究'),
  ]);
  assert.deepEqual(index.search('半導', groups, ['bad', 'good']).ids, ['good']);
  assert.deepEqual(index.search('股', ['股'], []).ids, ['stock']);
  assert.deepEqual(index.search('AI', ['ai'], ['bad', 'good']).ids, ['bad', 'good']);
});

test('fragment reference retains eligible primary order before independent recall', () => {
  const index = buildFragmentIndex([
    document('supplement', '半導體甲'),
    document('primary-2', '半導體乙'),
    document('primary-1', '半導體丙'),
  ]);
  assert.deepEqual(index.search('半導', ['半導'], ['primary-1', 'primary-2']).ids,
    ['primary-1', 'primary-2', 'supplement']);
});

test('metrics report judged recall without treating unjudged hits as irrelevant', () => {
  const metrics = evaluateResults({
    queries: [{ id: 'q', expectedIds: ['expected'], forbiddenIds: ['forbidden'] }],
    rankingCases: [],
  }, [{
    id: 'q', allIds: ['expected', 'unknown', 'forbidden'],
    first: { top20Ms: 3, fullMembershipMs: 4 },
    passes: [{ top20Ms: 1, fullMembershipMs: 2 }],
  }]);
  assert.deepEqual(metrics.judgedRecall, { found: 1, total: 1, value: 1 });
  assert.deepEqual(metrics.negativeViolations, [{ queryId: 'q', documentId: 'forbidden' }]);
  assert.equal(metrics.unjudgedResultCount, 1);
  assert.match(metrics.unjudgedResultMeaning, /not classified/u);
  assert.equal('precision' in metrics, false);
  assert.equal(metrics.timing.firstMeiliTop20.p50Ms, 3);
  assert.equal(metrics.timing.warmMeiliTop20.p50Ms, 1);
});

test('shutdown failure writes failure artifacts and rejects the run', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-eval-runner-test-'));
  try {
    const datasetPath = path.join(temporary, 'dataset.json');
    const binaryPath = path.join(temporary, 'binary');
    await writeFile(binaryPath, 'test');
    await writeFile(datasetPath, JSON.stringify({
      schemaVersion: 1,
      id: 'shutdown-test',
      documents: [document('doc', '內容')],
      queries: [{ id: 'q', query: '內容', expectedIds: ['doc'], forbiddenIds: [] }],
    }));
    const client = {
      async version() { return { pkgVersion: 'test' }; },
      async createEvaluationIndex() { return 'index'; },
      async settings() { return { dictionary: [], searchableAttributes: [] }; },
      async search() {
        return {
          normalizedQuery: '內容', topIds: ['doc'], allIds: ['doc'], totalHits: 1,
          top20Ms: 1, fullMembershipMs: 2, positions: { doc: [] },
        };
      },
    };
    const engine = { async stop() { throw new Error('stop failed'); } };
    const outputPath = path.join(temporary, 'out');
    await assert.rejects(runEvaluation({
      dataset: datasetPath, baseline: 'B0', binary: binaryPath,
      port: 7001, out: outputPath, passes: 1,
    }, { client, engine }), /stop failed/u);
    const manifest = JSON.parse(await readFile(path.join(outputPath, 'manifest.json')));
    const partial = JSON.parse(await readFile(path.join(outputPath, 'partial-results.json')));
    assert.equal(manifest.status, 'failed');
    assert.match(manifest.runnerSource.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(partial.status, 'failed');
    assert.equal(partial.completedQueries.length, 1);
    assert.equal(partial.completedQueries[0].first.top20Ms, 1);
    assert.equal(partial.completedQueries[0].passes.length, 1);
    assert.equal(JSON.stringify(manifest).includes('masterKey'), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('dataset.queries rows remain judged even when they carry exploratory metadata', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-eval-runner-test-'));
  try {
    const datasetPath = path.join(temporary, 'dataset.json');
    const binaryPath = path.join(temporary, 'binary');
    await writeFile(binaryPath, 'test');
    await writeFile(datasetPath, JSON.stringify({
      schemaVersion: 1,
      id: 'exploratory-metadata-test',
      documents: [document('doc', '正式命中')],
      queries: [{
        id: 'formal', query: '正式', expectedIds: ['doc'], forbiddenIds: [], exploratory: true,
      }],
      exploratoryQueries: ['額外'],
    }));
    const outputPath = path.join(temporary, 'out');
    const { results } = await runEvaluation({
      dataset: datasetPath, baseline: 'B0', binary: binaryPath,
      port: 7001, out: outputPath, passes: 1,
    }, { client: successfulClient(), engine: { async stop() {} } });
    assert.deepEqual(results.metrics.judgedRecall, { found: 1, total: 1, value: 1 });
    assert.equal(results.queries.find((query) => query.id === 'formal').evaluationSet, 'judged');
    assert.equal(results.queries.find((query) => query.id.startsWith('exploratory-')).evaluationSet, 'exploratory');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('an input changed during execution produces failure artifacts instead of a passing run', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'search-eval-runner-test-'));
  try {
    const datasetPath = path.join(temporary, 'dataset.json');
    const binaryPath = path.join(temporary, 'binary');
    await writeFile(binaryPath, 'before');
    await writeFile(datasetPath, JSON.stringify({
      schemaVersion: 1,
      id: 'input-change-test',
      documents: [document('doc', '內容')],
      queries: [{ id: 'q', query: '內容', expectedIds: ['doc'], forbiddenIds: [] }],
    }));
    const client = successfulClient(async () => { await writeFile(binaryPath, 'after'); });
    const outputPath = path.join(temporary, 'out');
    await assert.rejects(runEvaluation({
      dataset: datasetPath, baseline: 'B0', binary: binaryPath,
      port: 7001, out: outputPath, passes: 1,
    }, { client, engine: { async stop() {} } }), /inputs changed during the run/u);
    const manifest = JSON.parse(await readFile(path.join(outputPath, 'manifest.json')));
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.files.binary.unchanged, false);
    assert.notEqual(manifest.files.binary.sha256, manifest.files.binary.sha256After);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function document(id, bodyMarkdown) {
  return { id, title: 'title', bodyMarkdown, publisher: { id: 'publisher', name: 'publisher' } };
}

function successfulClient(onFirstSearch = async () => {}) {
  let searched = false;
  return {
    async version() { return { pkgVersion: 'test' }; },
    async createEvaluationIndex() { return 'index'; },
    async settings() { return { dictionary: [], searchableAttributes: [] }; },
    async search(_indexUid, query) {
      if (!searched) {
        searched = true;
        await onFirstSearch();
      }
      return {
        normalizedQuery: query, topIds: ['doc'], allIds: ['doc'], totalHits: 1,
        top20Ms: 1, fullMembershipMs: 2, positions: { doc: [] },
      };
    },
  };
}

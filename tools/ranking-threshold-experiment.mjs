import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ManagedMeilisearch } from '../src/meili.mjs';
import { loadDataset } from '../src/dataset.mjs';
import { createRankingProbe, summarizeThreshold } from '../src/ranking-thresholds.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--app-root', '--port', '--out'].includes(args[i]) || !args[i + 1] || args[i] in options) {
    throw new Error('Usage: node tools/ranking-threshold-experiment.mjs --app-root PATH --port RESERVED --out NEW_DIR');
  }
  options[args[i]] = args[i + 1];
}
if (!options['--app-root'] || !options['--out'] || !/^\d+$/u.test(options['--port'] ?? '')
  || Number(options['--port']) < 1 || Number(options['--port']) > 65535) throw new Error('Missing or invalid experiment options');
const appRoot = path.resolve(options['--app-root']);
const output = path.resolve(options['--out']);
await mkdir(output);
const requireApp = createRequire(path.join(appRoot, 'package.json'));
const { tsImport } = await import(pathToFileURL(requireApp.resolve('tsx/esm/api')));
const appImport = (relative) => tsImport(pathToFileURL(path.join(appRoot, relative)).href, import.meta.url);
const { MeilisearchBackend } = await appImport('src/search/meilisearch-backend.ts');
const { loadSearchLexicon } = await appImport('src/search/search-lexicon.ts');
const { planFragmentQuery } = await appImport('src/search/fragment-query.ts');
const lexiconRelative = 'resources/search/coct-main.txt';
const binaryRelative = `resources/bin/${process.platform === 'win32' ? 'win' : 'mac'}/meilisearch${process.platform === 'win32' ? '.exe' : ''}`;
const lexicon = await loadSearchLexicon(path.join(appRoot, lexiconRelative));
const tracked = [binaryRelative, lexiconRelative, 'resources/search/coct-main.json',
  `${path.dirname(binaryRelative)}/meilisearch-build.json`, 'package-lock.json',
  'src/search/meilisearch-backend.ts', 'src/search/contiguous-fragment-index.ts',
  'src/search/fragment-query.ts', 'src/search/search-lexicon.ts', 'src/search/search-normalization.ts',
  'src/search/meilisearch-process.ts', 'scripts/meilisearch-build-recipe.json'];
const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const fingerprint = async () => Object.fromEntries(await Promise.all(tracked.map(async (relative) => [relative, await digest(path.join(appRoot, relative))])));
const initial = await fingerprint();
const datasets = ['zh-semantics-v1', 'real-34', 'zh-contiguous-holdout-v1'];
const thresholds = [null, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95];
const manifest = {
  schemaVersion: 1, startedAt: new Date().toISOString(), thresholds,
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
  appSourceStatus: execFileSync('git', ['status', '--porcelain', '--', 'src/search', 'src/core', 'src/plugins', 'scripts/meilisearch-build-recipe.json'], { cwd: appRoot, encoding: 'utf8' }).trim(),
  evalCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  fingerprints: initial, lexicon: lexicon.identity,
  experimentFiles: Object.fromEntries(await Promise.all(['src/ranking-thresholds.mjs', 'tools/ranking-threshold-experiment.mjs'].map(async (file) => [file, await digest(path.join(root, file))]))),
  policy: 'Threshold every candidate retrieval (full query and Latin fallback); never threshold ID hydration. App fragment fallback remains unchanged and has no assigned relevance score.',
  labels: 'Fixed existing gold. Unjudged results are not negatives. Scores are engine ranking values, not probabilities.',
  datasets: [],
};
const rows = [];
await save('manifest.json', { ...manifest, status: 'running' });
try {
  for (const name of datasets) {
    const datasetRelative = `datasets/${name}/dataset.json`;
    const datasetPath = path.join(root, datasetRelative);
    const dataset = await loadDataset(datasetPath);
    const datasetHash = await digest(datasetPath);
    const engine = new ManagedMeilisearch({
      binary: path.join(appRoot, binaryRelative), port: Number(options['--port']),
      engineEnvironment: {
        XR_COLLECTOR_MEILISEARCH_DICTIONARY_PATH: lexicon.path,
        XR_COLLECTOR_MEILISEARCH_DISABLE_SECONDARY_SPLIT: '1',
      },
    });
    try {
      const client = await engine.start();
      const probe = createRankingProbe();
      const backendOptions = { baseUrl: client.baseUrl, apiKey: 'isolated-evaluation', fetch: probe.fetch };
      const app = new MeilisearchBackend({ ...backendOptions, lexicon });
      const raw = new MeilisearchBackend(backendOptions);
      await app.initialize();
      await app.replaceAll(dataset.documents.map((document) => ({
        type: 'article', sourceType: 'rss', sourceId: document.id, sourceUrl: '',
        publishedAt: null, collectedAt: '2026-10-28T00:00:00.000Z', ...document,
      })));
      const settings = await client.settings('documents_v3');
      const version = await client.version();
      manifest.datasets.push({ id: dataset.id, file: datasetRelative, sha256: datasetHash,
        documentCount: dataset.documents.length, queryCount: dataset.queries.length, settings, version });
      const runs = [];
      for (const [mode, backend] of [['engine', raw], ['app-162', app]]) {
        probe.enabled = false;
        probe.threshold = null;
        const uninstrumented = [];
        for (const query of dataset.queries) uninstrumented.push(await backend.search({ query: query.query, limit: 1000 }));
        probe.enabled = true;
        let baseline;
        for (const threshold of thresholds) {
          probe.threshold = threshold;
          const queries = [];
          for (const [index, query] of dataset.queries.entries()) {
            probe.records = [];
            const result = await backend.search({ query: query.query, limit: 1000 });
            assert.equal(result.hits.length, result.total, 'Dataset must fit in one product page');
            if (threshold === null) assert.deepEqual(result, uninstrumented[index], 'Score instrumentation changed product behavior');
            const plan = planFragmentQuery(query.query, lexicon);
            const primary = probe.records.filter((record) => record.q === plan.normalized).flatMap((record) => record.hits);
            const latin = probe.records.filter((record) => record.q === plan.latinQuery && record.q !== plan.normalized).flatMap((record) => record.hits);
            queries.push({ id: query.id, query: query.query, ids: result.hits.map((hit) => hit.id),
              primary, latin, groups: plan.groups,
              hits: result.hits.map((hit, rank) => ({ id: hit.id, rank: rank + 1,
                origin: mode === 'engine' || primary.some((entry) => entry.id === hit.id) ? 'engine-primary'
                  : latin.some((entry) => entry.id === hit.id) ? 'latin-fallback' : 'fragment-fallback',
                mainQueryScore: primary.find((entry) => entry.id === hit.id)?.score ?? null,
                latinQueryScore: latin.find((entry) => entry.id === hit.id)?.score ?? null,
              })),
            });
          }
          if (threshold === null) baseline = queries;
          const metrics = summarizeThreshold(dataset, queries, baseline);
          const row = { dataset: dataset.id, mode, threshold, ...metrics };
          rows.push(row);
          runs.push({ mode, threshold, queries, metrics });
          await save('summary.json', rows);
          console.log(JSON.stringify({ dataset: dataset.id, mode, threshold,
            found: `${metrics.expectedFound}/${metrics.expectedTotal}`, forbidden: metrics.forbiddenReturned,
            returned: metrics.returned, removedExpected: metrics.removedExpected.length }));
        }
      }
      assert.equal(await digest(datasetPath), datasetHash, 'Dataset changed during experiment');
      await save(`${name}.json`, { datasetId: dataset.id, runs });
    } finally {
      await engine.stop();
    }
  }
  assert.deepEqual(await fingerprint(), initial, 'Product source, engine or lexicon changed during experiment');
  await save('manifest.json', { ...manifest, status: 'succeeded', completedAt: new Date().toISOString(), instrumentationPreservesBaseline: true, inputsUnchanged: true });
} catch (error) {
  await save('manifest.json', { ...manifest, status: 'failed', error: error.stack });
  throw error;
}

async function save(name, value) {
  await writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
}

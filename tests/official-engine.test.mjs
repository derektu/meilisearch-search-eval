import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OFFICIAL_RELEASE, OFFICIAL_ASSETS, officialReleaseAsset, assertOfficialBinaryIdentity } from '../tools/engine/official-release.mjs';
import { downloadOfficialRelease } from '../tools/engine/download-official.mjs';
import { loadBaseline, verifyEngineIdentity } from '../src/baseline.mjs';
import { runEvaluation } from '../src/runner.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('official controls and Chinese-only source control are distinct baseline declarations', async () => {
  for (const id of ['B0', 'B1']) {
    const { config } = await loadBaseline(id);
    assert.equal(config.engine.distribution, 'official-release');
    assert.equal(config.engine.version, '1.53.2');
  }
  const { config } = await loadBaseline('C1');
  assert.equal(config.engine.kind, 'stock');
  assert.equal(config.engine.distribution, 'source-chinese-only');
  assert.equal(config.normalization, true);
  assert.equal(verifyEngineIdentity(config, { sha256: 'a'.repeat(64) }).verified, false);
});

test('pinned official community map selects host artifacts and has no enterprise fallback', () => {
  assert.equal(OFFICIAL_RELEASE.version, '1.53.2');
  const mac = officialReleaseAsset({ platform: 'darwin', arch: 'arm64' });
  assert.equal(mac.sha256, '7fa492746343c1dd7217ead82fc6d42e74c1304593e4604f52ca71cf44d61b28');
  for (const [key, asset] of Object.entries(OFFICIAL_ASSETS)) {
    assert.match(asset.url, /^https:\/\/github\.com\/meilisearch\/meilisearch\/releases\/download\/v1\.53\.2\/meilisearch-/u);
    assert(!asset.name.includes('enterprise'), key);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(assertOfficialBinaryIdentity({ ...asset }).verified, true);
  }
  assert.throws(() => officialReleaseAsset({ platform: 'darwin', arch: 'x64' }), /no pinned asset.*no enterprise or source-build fallback/u);
});

test('official identity rejects same-version source builds and suggests C1', async () => {
  const { config } = await loadBaseline('B1');
  const asset = officialReleaseAsset({ platform: 'darwin', arch: 'arm64' });
  assert.equal(verifyEngineIdentity(config, { sha256: asset.sha256, platform: 'darwin', arch: 'arm64' }).verified, true);
  assert.throws(() => verifyEngineIdentity(config, {
    sha256: 'e62000bacb1d0633b609c70589af67122bfdae07d0d036151387f9f8be6c83c7', platform: 'darwin', arch: 'arm64',
  }), /official community.*select C1/u);
});

test('runner rejects an unofficial B1 binary before engine start and writes failure evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'official-gate-'));
  try {
    const binary = path.join(directory, 'source-binary');
    const dataset = path.join(directory, 'dataset.json');
    await writeFile(binary, 'unofficial source build');
    await writeFile(dataset, JSON.stringify({ schemaVersion: 1, id: 'gate', documents: [{ id: 'doc', title: 'title', bodyMarkdown: '內容', publisher: { id: 'p', name: 'p' } }], queries: [{ id: 'q', query: '內容', expectedIds: ['doc'], forbiddenIds: [] }] }));
    let starts = 0, stops = 0;
    const engine = { async start() { starts++; throw new Error('must not reach start'); }, async stop() { stops++; } };
    const out = path.join(directory, 'out');
    await assert.rejects(runEvaluation({ dataset, binary, baseline: 'B1', out, port: 7001, passes: 1 }, { engine }), /B0\/B1 require the official community.*select C1/u);
    assert.equal(starts, 0);
    assert.equal(stops, 0);
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json')));
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.baselineConfig.engine.distribution, 'official-release');
    assert(manifest.runnerSource.files.includes('../tools/engine/official-release.mjs'));
    const partial = JSON.parse(await readFile(path.join(out, 'partial-results.json')));
    assert.equal(partial.completedQueries.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('official downloader verifies bytes before executing and reuses a verified local artifact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'official-download-'));
  try {
    const payload = Buffer.from('test community artifact');
    const selected = { ...officialReleaseAsset({ platform: 'darwin', arch: 'arm64' }), bytes: payload.length, sha256: hash(payload) };
    let fetches = 0, versions = 0;
    const dependencies = {
      assetResolver: () => selected,
      fetch: async (url) => { assert.equal(url, selected.url); fetches++; return new Response(payload); },
      readVersion: async (file) => { assert.equal(hash(await readFile(file)), selected.sha256); versions++; return 'meilisearch 1.53.2'; },
    };
    const first = await downloadOfficialRelease({ out: directory, platform: 'darwin', arch: 'arm64' }, dependencies);
    assert.equal(first.provenance.distribution, 'official-release');
    assert.equal(first.provenance.usedExistingFile, false);
    const second = await downloadOfficialRelease({ out: directory, platform: 'darwin', arch: 'arm64' }, dependencies);
    assert.equal(second.provenance.usedExistingFile, true);
    assert.equal(fetches, 1);
    assert.equal(versions, 2);
    assert.equal(JSON.parse(await readFile(second.manifest)).binary.sha256, selected.sha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt official download is never executed or promoted to an official filename', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'official-corrupt-'));
  try {
    const selected = { ...officialReleaseAsset({ platform: 'darwin', arch: 'arm64' }), bytes: 4, sha256: hash(Buffer.from('good')) };
    let versions = 0;
    await assert.rejects(downloadOfficialRelease({ out: directory, platform: 'darwin', arch: 'arm64' }, {
      assetResolver: () => selected,
      fetch: async () => new Response('evil'),
      readVersion: async () => { versions++; return 'meilisearch 1.53.2'; },
    }), /identity mismatch/u);
    assert.equal(versions, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseline, resolveEngineEnvironment } from './baseline.mjs';
import { buildFragmentIndex, prepareQueryGroups } from './fragments.mjs';
import { exploratoryQueries, loadDataset } from './dataset.mjs';
import { evaluateResults } from './evaluate.mjs';
import { ManagedMeilisearch } from './meili.mjs';
import {
  NORMALIZATION_REVISION,
  OPENCC_DATA_VERSION,
  normalizeSearchText,
} from './normalize.mjs';

export async function runEvaluation(options, dependencies = {}) {
  validateCommonOptions(options);
  const outputPath = path.resolve(options.out);
  await mkdir(outputPath);

  const datasetPath = path.resolve(options.dataset);
  const binaryPath = path.resolve(options.binary);
  const dictionaryPath = options.dictionary ? path.resolve(options.dictionary) : null;
  const tokenizerPath = options.tokenizer ? path.resolve(options.tokenizer) : null;
  let baselineRecord = null;
  let dataset = null;
  let engine = null;
  let engineEnvironment = {};
  let engineVersion = null;
  let indexSettings = null;
  let fragmentIndexInfo = null;
  let judgedQueryIds = new Set();
  let inputSnapshot = null;
  let inputVerification = null;
  const queryResults = [];
  let runError = null;

  try {
    baselineRecord = await loadBaseline(options.baseline);
    validateStrategyOptions(options, baselineRecord.config);
    inputSnapshot = await captureInputSnapshot({
      datasetPath,
      binaryPath,
      baselinePath: baselineRecord.path,
      dictionaryPath,
      tokenizerPath,
    });
    dataset = await loadDataset(datasetPath);
    judgedQueryIds = new Set(dataset.queries.map((query) => query.id));
    engineEnvironment = resolveEngineEnvironment(baselineRecord.config, dictionaryPath);
    const normalize = baselineRecord.config.normalization ? normalizeSearchText : (text) => text;
    engine = dependencies.engine ?? new ManagedMeilisearch({
      binary: binaryPath,
      port: options.port,
      engineEnvironment,
    });
    const client = dependencies.client ?? await engine.start();
    engineVersion = await client.version();
    const indexUid = await client.createEvaluationIndex(dataset.documents, { normalize });
    indexSettings = await client.settings(indexUid);
    const additionalExploratoryQueries = exploratoryQueries(dataset);
    const duplicateExploratory = additionalExploratoryQueries.find((query) => judgedQueryIds.has(query.id));
    if (duplicateExploratory) {
      throw new Error(`additional exploratory query duplicates dataset.queries id: ${duplicateExploratory.id}`);
    }
    const allQueries = [...dataset.queries, ...additionalExploratoryQueries];
    const queryGroups = baselineRecord.config.fragmentReference
      ? await prepareQueryGroups(allQueries, { tokenizer: tokenizerPath, dictionary: dictionaryPath })
      : null;
    const fragmentIndex = baselineRecord.config.fragmentReference
      ? buildFragmentIndex(dataset.documents)
      : null;
    if (fragmentIndex) {
      fragmentIndexInfo = {
        buildMs: fragmentIndex.buildMs,
        fieldCount: fragmentIndex.fieldCount,
        characterCount: fragmentIndex.characterCount,
        meaning: 'In-memory reference index; not production or end-to-end performance.',
      };
    }
    for (const query of allQueries) {
      const first = await executePass({ client, indexUid, query, normalize, fragmentIndex, queryGroups });
      const passes = [];
      for (let pass = 0; pass < options.passes; pass += 1) {
        const warm = await executePass({ client, indexUid, query, normalize, fragmentIndex, queryGroups });
        if (!sameIds(first.result.allIds, warm.result.allIds)) {
          throw new Error(`query ${query.id} returned unstable membership between first and warm passes`);
        }
        passes.push(warm.timing);
      }
      queryResults.push({
        id: query.id,
        query: query.query,
        evaluationSet: judgedQueryIds.has(query.id) ? 'judged' : 'exploratory',
        ...first.result,
        first: first.timing,
        passes,
      });
    }
  } catch (error) {
    runError = error;
  } finally {
    if (engine) {
      try {
        await engine.stop();
      } catch (stopError) {
        runError = runError
          ? new AggregateError([runError, stopError], 'evaluation and managed-engine shutdown failed')
          : stopError;
      }
    }
  }

  if (inputSnapshot) {
    inputVerification = await verifyInputSnapshot(inputSnapshot);
    if (!inputVerification.unchanged) {
      const changed = [
        ...Object.entries(inputVerification.files)
          .filter(([, record]) => !record.unchanged)
          .map(([name]) => name),
        ...(!inputVerification.runnerSource.unchanged ? ['runnerSource'] : []),
      ];
      const changedError = new Error(`evaluation inputs changed during the run: ${changed.join(', ')}`);
      runError = runError
        ? new AggregateError([runError, changedError], 'evaluation failed and inputs changed during the run')
        : changedError;
    }
  }

  const manifest = await buildManifest({
    options,
    baselineRecord,
    datasetPath,
    binaryPath,
    dictionaryPath,
    tokenizerPath,
    engineEnvironment,
    engineVersion,
    indexSettings,
    inputSnapshot,
    inputVerification,
    status: runError ? 'failed' : 'succeeded',
    error: runError,
  });
  try {
    await writeJson(path.join(outputPath, 'manifest.json'), manifest);
  } catch (artifactError) {
    runError = runError
      ? new AggregateError([runError, artifactError], 'evaluation and failure-manifest write failed')
      : artifactError;
  }

  if (runError) {
    const partial = {
      schemaVersion: 1,
      status: 'failed',
      datasetId: dataset?.id ?? null,
      baseline: options.baseline,
      error: publicError(runError),
      completedQueries: queryResults,
    };
    try {
      await writeJson(path.join(outputPath, 'partial-results.json'), partial);
    } catch (artifactError) {
      throw new AggregateError([runError, artifactError], 'evaluation and partial-results write failed');
    }
    throw runError;
  }

  const judgedResults = queryResults.filter((result) => judgedQueryIds.has(result.id));
  const payload = {
    schemaVersion: 1,
    status: 'succeeded',
    datasetId: dataset.id,
    baseline: options.baseline,
    warmPasses: options.passes,
    metrics: evaluateResults(dataset, judgedResults),
    ...(fragmentIndexInfo ? { fragmentReferenceIndex: fragmentIndexInfo } : {}),
    queries: queryResults,
  };
  await writeJson(path.join(outputPath, 'results.json'), payload);
  return { manifest, results: payload };
}

async function executePass({ client, indexUid, query, normalize, fragmentIndex, queryGroups }) {
  const primary = await client.search(indexUid, query.query, { normalize });
  const reference = fragmentIndex?.search(query.query, queryGroups.get(query.id), primary.allIds);
  const allIds = reference?.ids ?? primary.allIds;
  return {
    result: {
      allIds,
      topIds: allIds.slice(0, 20),
      ranks: Object.fromEntries(allIds.map((id, rank) => [id, rank])),
      totalHits: allIds.length,
      meiliTotalHits: primary.totalHits,
      normalizedQuery: primary.normalizedQuery,
      meiliPositions: Object.fromEntries(allIds.map((id) => [id, primary.positions[id] ?? []])),
      ...(reference ? {
        fragmentGroups: reference.groups,
        fragmentPositions: reference.positions,
        fragmentMode: reference.mode,
      } : {}),
    },
    timing: {
      top20Ms: primary.top20Ms,
      fullMembershipMs: primary.fullMembershipMs,
      ...(reference ? { referenceMs: reference.referenceMs } : {}),
    },
  };
}

function validateCommonOptions(options) {
  if (!options.dataset || !options.baseline || !options.binary || !options.out) {
    throw new Error('run requires --dataset, --baseline, --binary, and --out');
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port must be an integer from 1 to 65535');
  }
  if (!Number.isInteger(options.passes) || options.passes < 1) throw new Error('--passes must be a positive integer');
}

function validateStrategyOptions(options, baseline) {
  if (baseline.engine.kind === 'external-dictionary' && !options.dictionary) {
    throw new Error(`${baseline.id} requires --dictionary`);
  }
  if (baseline.fragmentReference && !options.tokenizer) throw new Error(`${baseline.id} requires --tokenizer`);
}

async function buildManifest(context) {
  const {
    options, baselineRecord, datasetPath, binaryPath, dictionaryPath, tokenizerPath,
    engineEnvironment, engineVersion, indexSettings, inputSnapshot, inputVerification, status, error,
  } = context;
  const files = inputVerification?.files ?? inputSnapshot?.files ?? {
    dataset: await safeFileRecord(datasetPath),
    binary: await safeFileRecord(binaryPath),
    ...(baselineRecord ? { baselineConfig: await safeFileRecord(baselineRecord.path) } : {}),
    ...(dictionaryPath ? { dictionary: await safeFileRecord(dictionaryPath) } : {}),
    ...(tokenizerPath ? { tokenizer: await safeFileRecord(tokenizerPath) } : {}),
  };
  return {
    schemaVersion: 1,
    status,
    createdAt: new Date().toISOString(),
    baseline: options.baseline,
    baselineConfig: baselineRecord?.config ?? null,
    files,
    runnerSource: inputVerification?.runnerSource ?? inputSnapshot?.runnerSource ?? await sourceTreeRecord(),
    engine: {
      version: engineVersion,
      settings: indexSettings,
      environment: engineEnvironment,
      meiliDictionarySetting: indexSettings?.dictionary ?? null,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      port: options.port,
      warmPasses: options.passes,
      matchingStrategy: 'all',
      firstTopLimit: 20,
      fullMembershipPageSize: 100,
    },
    normalization: baselineRecord?.config.normalization ? {
      revision: NORMALIZATION_REVISION,
      openCcDataVersion: OPENCC_DATA_VERSION,
      rules: 'NFKC; ASCII lowercase; OpenCC s2t then t2tw; 臺 to 台; Unicode White_Space collapse and trim',
    } : null,
    ...(error ? { error: publicError(error) } : {}),
    dataPolicy: 'Results contain query text, IDs, ranks, timings, and positions; source document bodies and snippets are omitted.',
    secrets: 'No master key was generated or recorded.',
  };
}

async function safeFileRecord(filePath) {
  try {
    return { path: filePath, sha256: await sha256(filePath) };
  } catch (error) {
    return { path: filePath, sha256: null, error: error.message };
  }
}

async function captureInputSnapshot({ datasetPath, binaryPath, baselinePath, dictionaryPath, tokenizerPath }) {
  const paths = {
    dataset: datasetPath,
    binary: binaryPath,
    baselineConfig: baselinePath,
    ...(dictionaryPath ? { dictionary: dictionaryPath } : {}),
    ...(tokenizerPath ? { tokenizer: tokenizerPath } : {}),
  };
  const files = {};
  for (const [name, filePath] of Object.entries(paths)) {
    files[name] = { path: filePath, sha256: await sha256(filePath) };
  }
  return { files, runnerSource: await sourceTreeRecord() };
}

async function verifyInputSnapshot(snapshot) {
  const files = {};
  for (const [name, before] of Object.entries(snapshot.files)) {
    const after = await safeFileRecord(before.path);
    files[name] = {
      ...before,
      sha256After: after.sha256,
      unchanged: before.sha256 === after.sha256,
      ...(after.error ? { verificationError: after.error } : {}),
    };
  }
  const sourceAfter = await sourceTreeRecord();
  const runnerSource = {
    ...snapshot.runnerSource,
    sha256After: sourceAfter.sha256,
    unchanged: snapshot.runnerSource.sha256 === sourceAfter.sha256,
  };
  return {
    files,
    runnerSource,
    unchanged: Object.values(files).every((record) => record.unchanged) && runnerSource.unchanged,
  };
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function sourceTreeRecord() {
  const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
  const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.mjs')).sort();
  const hash = createHash('sha256');
  for (const name of files) {
    hash.update(name);
    hash.update('\0');
    for await (const chunk of createReadStream(path.join(sourceDirectory, name))) hash.update(chunk);
    hash.update('\0');
  }
  return { algorithm: 'sha256(path NUL content NUL)', files, sha256: hash.digest('hex') };
}

function publicError(error) {
  if (error instanceof AggregateError) {
    return { name: error.name, message: error.message, errors: error.errors.map(publicError) };
  }
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function writeJson(filePath, value) {
  return writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_RELEASE, assertOfficialBinaryIdentity } from '../tools/engine/official-release.mjs';

export async function loadBaseline(baselineId) {
  if (!/^(?:B[0-4]|C1)$/u.test(baselineId ?? '')) throw new Error('baseline must be one of B0, B1, B2, B3, B4, C1');
  const url = new URL(`../baselines/${baselineId}.json`, import.meta.url);
  const config = JSON.parse(await readFile(url, 'utf8'));
  validateBaseline(config, baselineId);
  return { config, path: fileURLToPath(url) };
}

function validateBaseline(config, expectedId) {
  if (config?.id !== expectedId) throw new Error(`baseline config ${expectedId} has a mismatched id`);
  if (typeof config.label !== 'string' || typeof config.normalization !== 'boolean'
    || typeof config.fragmentReference !== 'boolean') {
    throw new Error(`baseline config ${expectedId} has invalid fields`);
  }
  if (!['stock', 'external-dictionary'].includes(config.engine?.kind)
    || !isStringRecord(config.engine?.env)) {
    throw new Error(`baseline config ${expectedId} has an invalid engine`);
  }
  if (['B0', 'B1'].includes(expectedId)
    && (config.engine.kind !== 'stock' || config.engine.distribution !== 'official-release'
      || config.engine.version !== OFFICIAL_RELEASE.version)) {
    throw new Error(`${expectedId} must declare official-release ${OFFICIAL_RELEASE.version}; use C1 for the source Chinese-only control`);
  }
  if (expectedId === 'C1'
    && (config.engine.kind !== 'stock' || config.engine.distribution !== 'source-chinese-only'
      || config.engine.version !== OFFICIAL_RELEASE.version || !config.normalization)) {
    throw new Error(`C1 must declare the normalized source-chinese-only ${OFFICIAL_RELEASE.version} control`);
  }
  const external = config.engine.kind === 'external-dictionary';
  if (external !== ('SEARCH_EVAL_DICTIONARY_PATH' in config.engine.env)) {
    throw new Error(`baseline config ${expectedId} dictionary environment does not match engine.kind`);
  }
  if (config.fragmentReference && !external) {
    throw new Error(`baseline config ${expectedId} cannot use fragmentReference with a stock engine`);
  }
}

function isStringRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

export function resolveEngineEnvironment(config, dictionaryPath) {
  return Object.fromEntries(Object.entries(config.engine.env).map(([key, value]) => {
    if (value === '${DICTIONARY_PATH}') {
      if (!dictionaryPath) throw new Error(`${config.id} requires --dictionary`);
      return [key, dictionaryPath];
    }
    if (/\$\{[^}]+\}/u.test(value)) throw new Error(`unresolved environment placeholder in ${config.id}: ${value}`);
    return [key, value];
  }));
}

/** Official controls are digest-gated; locally built controls retain their recorded hash. */
export function verifyEngineIdentity(config, { sha256, platform = process.platform, arch = process.arch }) {
  if (config.engine.distribution === 'official-release') {
    return assertOfficialBinaryIdentity({ sha256, platform, arch });
  }
  return {
    distribution: config.engine.distribution ?? config.engine.kind,
    configuredVersion: config.engine.version ?? null,
    sha256,
    verified: false,
    meaning: 'Caller-supplied source build; hash is recorded, not matched against an official release asset.',
  };
}

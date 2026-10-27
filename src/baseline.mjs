import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function loadBaseline(baselineId) {
  if (!/^B[0-4]$/u.test(baselineId ?? '')) throw new Error('baseline must be one of B0, B1, B2, B3, B4');
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

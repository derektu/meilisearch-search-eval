#!/usr/bin/env node
import { compareRuns } from './compare.mjs';
import { runEvaluation } from './runner.mjs';

const [, , command, ...rawArguments] = process.argv;

try {
  if (command === '--help' || command === 'help' || command === undefined) {
    process.stdout.write(`${usage()}\n`);
  } else if (command === 'run') {
    const argumentsByName = parseArguments(rawArguments, new Set([
      'dataset', 'baseline', 'binary', 'dictionary', 'tokenizer', 'port', 'out', 'passes',
    ]));
    const { results } = await runEvaluation({
      dataset: argumentsByName.dataset,
      baseline: argumentsByName.baseline,
      binary: argumentsByName.binary,
      dictionary: argumentsByName.dictionary,
      tokenizer: argumentsByName.tokenizer,
      port: integerArgument(argumentsByName.port, '--port'),
      out: argumentsByName.out,
      passes: argumentsByName.passes === undefined ? 3 : integerArgument(argumentsByName.passes, '--passes'),
    });
    process.stdout.write(`${JSON.stringify({
      datasetId: results.datasetId,
      baseline: results.baseline,
      metrics: results.metrics,
    })}\n`);
  } else if (command === 'compare') {
    const argumentsByName = parseArguments(rawArguments, new Set(['runs', 'out']));
    if (!argumentsByName.runs || !argumentsByName.out) throw new Error('compare requires --runs and --out');
    const comparison = await compareRuns(
      argumentsByName.runs.split(',').filter(Boolean),
      argumentsByName.out,
    );
    process.stdout.write(`${JSON.stringify(comparison)}\n`);
  } else {
    throw new Error(usage());
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

function parseArguments(raw, allowed) {
  const parsed = {};
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index];
    const value = raw[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`expected --name value, got ${key ?? '<end>'}`);
    }
    const name = key.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown option: ${key}`);
    if (parsed[name] !== undefined) throw new Error(`duplicate option: ${key}`);
    parsed[name] = value;
  }
  return parsed;
}

function integerArgument(value, label) {
  if (value === undefined || !/^\d+$/u.test(value)) throw new Error(`${label} must be an integer`);
  return Number(value);
}

function usage() {
  return [
    'Usage:',
    '  node src/cli.mjs run --dataset PATH --baseline B0..B4|C1 --binary ABS --port RESERVED --out UNIQUE_DIR [--dictionary ABS] [--tokenizer ABS] [--passes 3]',
    '  node src/cli.mjs compare --runs DIR,DIR,... --out FILE',
  ].join('\n');
}

#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function validateDataset(dataset) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(dataset.schemaVersion === 1 && typeof dataset.id === 'string', 'Expected schemaVersion:1 and dataset id.');
  check(Array.isArray(dataset.documents) && Array.isArray(dataset.queries), 'documents and queries must be arrays.');
  const ids = new Set();
  for (const doc of dataset.documents) {
    check(typeof doc.id === 'string' && !ids.has(doc.id), 'Missing or duplicate document id.');
    ids.add(doc.id);
    check(typeof doc.title === 'string' && typeof doc.bodyMarkdown === 'string', `Missing text fields for ${doc.id}.`);
    check(typeof doc.publisher?.id === 'string' && typeof doc.publisher?.name === 'string', `Missing publisher for ${doc.id}.`);
  }
  const queries = new Set();
  for (const query of dataset.queries) {
    check(typeof query.id === 'string' && !queries.has(query.id), 'Missing or duplicate query id.');
    queries.add(query.id);
    check(typeof query.query === 'string' && query.query.length > 0, `Missing query text for ${query.id}.`);
    for (const key of ['expectedIds', 'forbiddenIds']) {
      check(Array.isArray(query[key]), `Missing ${key} for ${query.id}.`);
      check(new Set(query[key]).size === query[key].length && query[key].every(id => ids.has(id)), `Invalid ${key} for ${query.id}.`);
    }
    check(query.expectedIds.every(id => !query.forbiddenIds.includes(id)), `Contradictory gold for ${query.id}.`);
    check(!query.expectZero || query.expectedIds.length === 0, `expectZero contradicts expectedIds for ${query.id}.`);
  }
  for (const ranking of dataset.rankingCases ?? []) {
    check(ids.has(ranking.preferredId) && ids.has(ranking.overId), 'Ranking references unknown documents.');
    check(dataset.queries.some(q => q.query === ranking.query), 'Ranking query has no membership case.');
  }
  return { id: dataset.id, documents: ids.size, queries: queries.size, expectedPairs: dataset.queries.reduce((n, q) => n + q.expectedIds.length, 0), forbiddenPairs: dataset.queries.reduce((n, q) => n + q.forbiddenIds.length, 0) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ?? fileURLToPath(new URL('../../datasets/zh-semantics-v1/dataset.json', import.meta.url));
  console.log(JSON.stringify(validateDataset(JSON.parse(await readFile(input, 'utf8')))));
}

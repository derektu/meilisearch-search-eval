#!/usr/bin/env node
/** Explicit import of an existing, rights-controlled snapshot. Never fetches source text. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--documents', '--queries', '--output'].includes(key) || !value || args.has(key)) {
    throw new Error('Usage: node tools/datasets/import-local.mjs --documents /path/to/SavedDocuments.json [--queries /path/to/queries.json] [--output .cache/datasets/real-34/dataset.json]');
  }
  args.set(key, value);
}
if (!args.has('--documents')) throw new Error('--documents is required; this tool does not download or discover private source text.');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'datasets/real-34/source-manifest.json'), 'utf8'));
const publicQueries = JSON.parse(await readFile(path.join(root, 'datasets/real-34/queries.json'), 'utf8'));
const documents = JSON.parse(await readFile(path.resolve(args.get('--documents')), 'utf8'));
if (!Array.isArray(documents) || documents.length !== manifest.documentCount || hash(documents) !== manifest.sourceSnapshot.documentsJsonSha256) {
  throw new Error('Document snapshot SHA-256/count mismatch. Re-fetching the same URLs does not reproduce the original snapshot.');
}
for (const [index, doc] of documents.entries()) {
  const expected = manifest.documents[index];
  if (doc.id !== expected.id || hash(doc) !== expected.documentJsonSha256) throw new Error(`Document hash mismatch at index ${index}.`);
}
if (args.has('--queries')) {
  const provided = JSON.parse(await readFile(path.resolve(args.get('--queries')), 'utf8'));
  if (![manifest.sourceSnapshot.originalQueriesJsonSha256, manifest.sourceSnapshot.publicQueriesJsonSha256].includes(hash(provided))) {
    throw new Error('Query snapshot SHA-256 mismatch; use the original snapshot queries or the public query/gold file.');
  }
}
if (hash(publicQueries) !== manifest.sourceSnapshot.publicQueriesJsonSha256) throw new Error('Public query/gold file hash mismatch.');
const output = path.resolve(root, args.get('--output') ?? '.cache/datasets/real-34/dataset.json');
const privateRoot = path.join(root, '.cache');
if (!output.startsWith(privateRoot + path.sep)) throw new Error('Private source text output must remain inside this repository’s ignored .cache/ directory.');
const dataset = {
  schemaVersion: 1,
  id: 'real-34',
  access: 'local-only-source-text',
  provenance: { snapshotDate: manifest.snapshotDate, ...manifest.sourceSnapshot },
  documents,
  // Publishable metadata only. Do not carry over third-party title/evidence excerpts.
  queries: publicQueries,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(dataset, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ id: dataset.id, documents: documents.length, queries: publicQueries.length, documentsJsonSha256: hash(documents), output: path.relative(root, output), status: 'verified-local-snapshot' }));

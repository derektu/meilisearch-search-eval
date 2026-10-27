#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSearchText, NORMALIZATION_REVISION, OPENCC_DATA_VERSION } from '../../src/normalize.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/lexicons/coct-1141208');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(cache, 'raw.jsonl');
const output = process.argv[3] ? path.resolve(process.argv[3]) : cache;
if (!output.startsWith(path.join(root, '.cache') + path.sep)) throw new Error('COCT derivatives must remain inside ignored .cache/.');
const hash = value => createHash('sha256').update(value).digest('hex');
const entries = new Map();
let rawRows = 0, rejectedRows = 0;
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line) continue;
  const row = JSON.parse(line);
  rawRows++;
  if (typeof row.word !== 'string' || !Number.isSafeInteger(row.news) || row.news < 0) throw new Error(`Invalid COCT row ${rawRows}.`);
  const word = normalizeSearchText(row.word);
  if (!word || /\s/u.test(word)) { rejectedRows++; continue; }
  const current = entries.get(word) ?? { news: 0, originals: [] };
  current.news += row.news;
  if (!Number.isSafeInteger(current.news)) throw new Error(`Frequency overflow at row ${rawRows}.`);
  current.originals.push(row.word);
  entries.set(word, current);
}
const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const dictionary = sorted.map(([word, row]) => `${word} ${Math.max(1, row.news)} n`).join('\n') + '\n';
const actualHash = hash(dictionary);
const expectedHash = '4b2d026eaa353ffde900f36049e72f1fa6902fbf25b14dbcb0b675d541e01264';
if (rawRows !== 163701 || entries.size !== 162966 || rejectedRows !== 0 || actualHash !== expectedHash) {
  throw new Error(`Prepared lexicon differs from the pinned experiment: ${JSON.stringify({ rawRows, uniqueTerms: entries.size, rejectedRows, sha256: actualHash })}`);
}
const manifest = {
  schemaVersion: 1,
  id: 'coct-news-1141208',
  source: { url: 'https://coct.naer.edu.tw/file/files/%E9%80%9A%E7%94%A8%E8%A9%9E%E9%A0%BB%E8%A1%A8%20-%20%E5%AE%9A%E7%A8%BF1141208.xlsx', sha256: 'bfd3b73938e115ae39a44c5e11c97135c09939cf598157cb2fe0b33c4302de75', fileVersion: '定稿1141208', fileLastModified: 'Mon, 08 Dec 2025 00:24:59 GMT', corpusCollectionPeriod: 'not established', license: 'Product redistribution/derivative terms not established; public availability is not an open-license assertion.' },
  extraction: { sheet: '通用詞頻表', wordColumn: 'B', rawNewsCountColumn: 'I', rawRows },
  normalization: { revision: NORMALIZATION_REVISION, openccVersion: OPENCC_DATA_VERSION, implementation: 'src/normalize.mjs' },
  frequency: 'Sum raw news counts for normalized collisions; floor each resulting zero to 1. POS n is an unused placeholder. No gold/query-dependent word selection.',
  uniqueTerms: entries.size,
  rejectedRows,
  collisionGroups: sorted.filter(([, row]) => row.originals.length > 1).length,
  zeroNewsFloored: sorted.filter(([, row]) => row.news === 0).length,
  output: { file: 'coct-news.txt', sha256: actualHash, bytes: Buffer.byteLength(dictionary) },
};
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'coct-news.txt'), dictionary);
await writeFile(path.join(output, 'terms.json'), JSON.stringify(sorted.map(([word]) => word)) + '\n');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));

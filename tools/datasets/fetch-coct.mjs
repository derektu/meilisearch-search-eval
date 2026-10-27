#!/usr/bin/env node
/** Explicit optional download; no lexicon or raw workbook is committed to this repository. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/lexicons/coct-1141208');
const source = path.join(cache, 'source.xlsx');
const url = 'https://coct.naer.edu.tw/file/files/%E9%80%9A%E7%94%A8%E8%A9%9E%E9%A0%BB%E8%A1%A8%20-%20%E5%AE%9A%E7%A8%BF1141208.xlsx';
const expected = 'bfd3b73938e115ae39a44c5e11c97135c09939cf598157cb2fe0b33c4302de75';
if (process.argv.length > 2) throw new Error('Usage: node tools/datasets/fetch-coct.mjs (PYTHON may name a Python 3 executable).');
await mkdir(cache, { recursive: true });
try { await access(source); } catch {
  console.log('Downloading the pinned public COCT workbook. Redistribution rights remain unconfirmed; outputs stay in ignored .cache/.');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`COCT download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Downloaded COCT XLSX SHA-256 mismatch; source may have changed.');
  await writeFile(source, bytes);
}
if (createHash('sha256').update(await readFile(source)).digest('hex') !== expected) throw new Error('Cached COCT XLSX SHA-256 mismatch; refusing to use it.');
const raw = path.join(cache, 'raw.jsonl');
for (const [command, args] of [
  [process.env.PYTHON ?? 'python3', [path.join(root, 'tools/datasets/extract-coct.py'), source, raw]],
  [process.execPath, [path.join(root, 'tools/datasets/prepare-coct.mjs'), raw, cache]],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`COCT preparation subprocess failed (${result.status}).`);
}

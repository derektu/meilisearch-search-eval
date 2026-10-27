#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_RELEASE, officialReleaseAsset } from './official-release.mjs';

const execute = promisify(execFile);
const defaultOutput = fileURLToPath(new URL('../../.cache/engines/', import.meta.url));
async function fileIdentity(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { sha256: hash.digest('hex'), bytes: (await stat(file)).size };
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function nativeVersion(file) { return (await execute(file, ['--version'], { timeout: 30_000, windowsHide: true })).stdout.trim(); }
function assertBytes(identity, selected) {
  if (identity.sha256 !== selected.sha256 || identity.bytes !== selected.bytes) {
    throw new Error(`Official release identity mismatch: expected ${selected.sha256} / ${selected.bytes} bytes, received ${identity.sha256} / ${identity.bytes} bytes`);
  }
}

export async function downloadOfficialRelease(options = {}, dependencies = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const selected = (dependencies.assetResolver ?? officialReleaseAsset)({ platform, arch });
  const fetchImplementation = dependencies.fetch ?? fetch;
  const readVersion = dependencies.readVersion ?? nativeVersion;
  const directory = path.resolve(options.out ?? defaultOutput);
  const suffix = platform === 'win32' ? '.exe' : '';
  const binary = path.join(directory, `meilisearch-official${suffix}`);
  const manifest = `${binary}.manifest.json`;
  const temporary = path.join(directory, `.official-download-${process.pid}-${randomBytes(6).toString('hex')}${suffix}`);
  await mkdir(directory, { recursive: true });
  let usedExistingFile = false;
  let identity;
  let versionOutput;
  try {
    if (await exists(binary)) {
      identity = await fileIdentity(binary);
      try { assertBytes(identity, selected); }
      catch (error) { throw new Error(`${error.message}. Existing ${binary} was preserved; move it aside before downloading another artifact.`); }
      await chmod(binary, 0o755);
      versionOutput = await readVersion(binary);
      usedExistingFile = true;
    } else {
      const response = await fetchImplementation(selected.url);
      if (!response.ok || !response.body) throw new Error(`Official community asset download failed: HTTP ${response.status} ${selected.url}`);
      const digest = createHash('sha256'); let bytes = 0;
      const meter = new Transform({ transform(chunk, _encoding, callback) { digest.update(chunk); bytes += chunk.length; callback(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o755 }));
      identity = { sha256: digest.digest('hex'), bytes };
      assertBytes(identity, selected); // Verify bytes before executing a downloaded file.
      await chmod(temporary, 0o755);
      versionOutput = await readVersion(temporary);
      if (versionOutput !== `meilisearch ${OFFICIAL_RELEASE.version}`) throw new Error(`Unexpected official binary --version: ${versionOutput}`);
      await rename(temporary, binary);
    }
    if (versionOutput !== `meilisearch ${OFFICIAL_RELEASE.version}`) throw new Error(`Unexpected official binary --version: ${versionOutput}`);
    const provenance = {
      schemaVersion: 1, distribution: 'official-release',
      release: OFFICIAL_RELEASE, asset: selected,
      platform, arch, obtainedAt: new Date().toISOString(), usedExistingFile,
      binary: { path: binary, ...identity, versionOutput },
      verification: { sha256: true, bytes: true, version: true },
      fallback: 'None; community release assets only.',
    };
    const manifestTemporary = `${temporary}.manifest.json`;
    await writeFile(manifestTemporary, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
    await rename(manifestTemporary, manifest);
    return { binary, manifest, provenance };
  } finally {
    await rm(temporary, { force: true });
    await rm(`${temporary}.manifest.json`, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node tools/engine/download-official.mjs [--out DIRECTORY]\nDownloads the pinned official community 1.53.2 host asset, checks SHA-256/bytes/--version, and writes meilisearch-official[.exe] plus its provenance manifest.');
  } else {
    let out;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('Use --help or --out DIRECTORY');
      out = args[1];
    }
    downloadOfficialRelease({ out }).then(({ binary, manifest, provenance }) => {
      console.log(JSON.stringify({ binary, manifest, sha256: provenance.binary.sha256 }));
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

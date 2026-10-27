#!/usr/bin/env node
/** Fetch pinned primary sources; patch an isolated Charabia copy; build outside tracked files. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rename, access, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MEILI_COMMIT = 'ec006cecec6f684b1dcaee093a45ab4c05707127';
const LOCK_SHA = 'f884034e00ae026ecc9a3c15999b11857dff4a99ba8d7c0528626571627cefbf';
const CHARABIA_VERSION = '0.10.0';
const CHARABIA_SHA = '27d98f4c66de52108210ee491c9c991513021dfd259bf65e4bbd889687b488d7';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tools/engine/build.mjs [--kind external|stock] [--target TRIPLE] [--target-dir PATH] [--toolchain 1.91.1] [--dictionary ABS_PATH] [--prepare-only]\nDefault output: .cache/engines/meilisearch-coct-external[.exe], adjacent .manifest.json. --kind stock produces meilisearch-chinese-only, never the official-release control. No dictionary is bundled.');
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === '--prepare-only') options.prepareOnly = true;
  else if (['--kind', '--target', '--target-dir', '--toolchain', '--dictionary'].includes(flag)) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${flag}`);
    options[flag.slice(2)] = args[++i];
  } else throw Error(`Unknown option ${flag}; use --help`);
}
const kind = options.kind ?? 'external';
if (!['external', 'stock'].includes(kind)) throw Error('--kind must be external or stock');
const toolchain = options.toolchain ?? '1.91.1';
const cache = path.join(root, '.cache');
const buildRoot = path.join(cache, 'engine-build');
const source = path.join(buildRoot, 'source', `meilisearch-${MEILI_COMMIT}`);
const targetDir = path.resolve(root, options['target-dir'] ?? '.cache/engine-build/target');
const patchFile = path.join(root, 'tools/engine/charabia-external-dictionary.patch');
const validatorFile = path.join(root, 'tools/engine/dictionary.rs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
function run(command, argv, { cwd = root, capture = false, env = process.env } = {}) {
  const result = spawnSync(command, argv, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${argv.join(' ')} exited ${result.status}${capture ? `\n${result.stderr || result.stdout}` : ''}`);
  return capture ? result.stdout.trim() : '';
}
function packageBlock(lock, name, version) {
  return lock.split('[[package]]').find((block) => block.includes(`name = "${name}"\n`) && block.includes(`version = "${version}"\n`));
}
async function verifySource() {
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: source, capture: true });
  if (head !== MEILI_COMMIT) throw Error(`Cached source HEAD mismatch: ${head}`);
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source, capture: true })) throw Error('Cached Meilisearch source is dirty; preserve/investigate it rather than building a different source');
  const lock = await readFile(path.join(source, 'Cargo.lock'));
  if (hash(lock) !== LOCK_SHA) throw Error('Pinned Meilisearch Cargo.lock checksum mismatch');
  if (!packageBlock(lock.toString(), 'charabia', CHARABIA_VERSION)?.includes(`checksum = "${CHARABIA_SHA}"`)) throw Error('Pinned Cargo.lock does not select the expected Charabia crate');
  if (!packageBlock(lock.toString(), 'jieba-rs', '0.10.3')) throw Error('Pinned Cargo.lock does not select jieba-rs 0.10.3');
}
async function prepareSource() {
  if (!await exists(source)) {
    const staging = `${source}.preparing-${process.pid}`;
    await mkdir(staging, { recursive: true });
    run('git', ['init', '--quiet'], { cwd: staging });
    run('git', ['remote', 'add', 'origin', 'https://github.com/meilisearch/meilisearch.git'], { cwd: staging });
    run('git', ['fetch', '--depth', '1', 'origin', MEILI_COMMIT], { cwd: staging });
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: staging });
    await rename(staging, source);
  }
  await verifySource();
}
async function prepareCharabia() {
  const patchBytes = await readFile(patchFile), validator = await readFile(validatorFile);
  const identity = hash(Buffer.concat([patchBytes, validator]));
  const destination = path.join(buildRoot, 'source', `charabia-${CHARABIA_VERSION}-${identity.slice(0, 16)}`);
  const identityFile = path.join(destination, '.search-eval-identity.json');
  if (await exists(destination)) {
    const saved = JSON.parse(await readFile(identityFile, 'utf8'));
    if (saved.identity !== identity || hash(await readFile(path.join(destination, 'src/segmenter/chinese.rs'))) !== saved.chineseSha256 || hash(await readFile(path.join(destination, 'src/segmenter/search_eval_dictionary.rs'))) !== hash(validator) || hash(await readFile(path.join(destination, 'Cargo.toml'))) !== saved.cargoTomlSha256) throw Error('Isolated Charabia cache was modified; preserve/investigate it');
    return { directory: destination, ...saved };
  }
  const downloads = path.join(cache, 'downloads'); await mkdir(downloads, { recursive: true });
  const archive = path.join(downloads, `charabia-${CHARABIA_VERSION}.crate`);
  if (!await exists(archive)) {
    const response = await fetch(`https://static.crates.io/crates/charabia/charabia-${CHARABIA_VERSION}.crate`);
    if (!response.ok) throw Error(`Charabia download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== CHARABIA_SHA) throw Error('Downloaded Charabia checksum mismatch');
    const partial = `${archive}.part-${process.pid}`; await writeFile(partial, bytes, { flag: 'wx' }); await rename(partial, archive);
  }
  if (hash(await readFile(archive)) !== CHARABIA_SHA) throw Error('Cached Charabia archive checksum mismatch');
  const unpack = path.join(buildRoot, `unpack-${process.pid}`); await mkdir(unpack, { recursive: false });
  try {
    run('tar', ['-xzf', archive, '-C', unpack]);
    const directory = path.join(unpack, `charabia-${CHARABIA_VERSION}`);
    run('git', ['apply', '--unsafe-paths', '--directory', directory, '--check', patchFile]);
    run('git', ['apply', '--unsafe-paths', '--directory', directory, patchFile]);
    await copyFile(validatorFile, path.join(directory, 'src/segmenter/search_eval_dictionary.rs'));
    const saved = { identity, patchSha256: hash(patchBytes), validatorSha256: hash(validator), chineseSha256: hash(await readFile(path.join(directory, 'src/segmenter/chinese.rs'))), cargoTomlSha256: hash(await readFile(path.join(directory, 'Cargo.toml'))) };
    await writeFile(path.join(directory, '.search-eval-identity.json'), JSON.stringify(saved, null, 2) + '\n');
    await rename(directory, destination);
    return { directory: destination, ...saved };
  } finally { await rm(unpack, { recursive: true, force: true }); }
}
async function dictionaryMetadata(file) {
  if (!file) return null;
  if (!path.isAbsolute(file)) throw Error('--dictionary must be an absolute path');
  const bytes = await readFile(file), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let entries = 0, zeroFrequencyEntries = 0, positive = false;
  for (const [i, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 2 || fields.length > 3 || !/^\d+$/u.test(fields[1])) throw Error(`Dictionary line ${i + 1}: expected word unsigned-frequency [tag]`);
    const frequency = BigInt(fields[1]);
    if (frequency > 18446744073709551615n) throw Error(`Dictionary line ${i + 1}: frequency exceeds 64-bit usize`);
    entries++; if (frequency === 0n) zeroFrequencyEntries++; else positive = true;
  }
  if (!entries || !positive) throw Error('Dictionary needs at least one positive-frequency entry; individual zeros are allowed');
  return { path: file, sha256: hash(bytes), bytes: bytes.length, entries, zeroFrequencyEntries, embeddedInBinary: false };
}

await mkdir(path.join(buildRoot, 'source'), { recursive: true });
const dictionary = await dictionaryMetadata(options.dictionary);
await prepareSource();
const override = kind === 'external' ? await prepareCharabia() : null;
const rustc = run('rustc', [`+${toolchain}`, '-vV'], { capture: true });
const host = rustc.match(/^host: (.+)$/mu)?.[1];
if (!host) throw Error('Cannot determine Rust host target');
const target = options.target ?? host;
const suffix = target.includes('windows') ? '.exe' : '';
const output = path.join(cache, 'engines', `meilisearch-${kind === 'external' ? 'coct-external' : 'chinese-only'}${suffix}`);
const manifestFile = `${output}.manifest.json`;
const metadata = { schemaVersion: 1, purpose: 'Research engine, not a product distribution or bit-for-bit reproducibility guarantee', kind, distribution: kind === 'stock' ? 'source-chinese-only' : 'external-dictionary', source: { repository: 'https://github.com/meilisearch/meilisearch.git', commit: MEILI_COMMIT, version: '1.53.2', cargoLockSha256: LOCK_SHA }, charabia: { version: CHARABIA_VERSION, archiveSha256: CHARABIA_SHA, override }, jiebaRsVersion: '0.10.3', toolchain, rustc, host, target, profile: 'release', features: ['chinese'], defaultFeatures: false, targetDir, dictionary, environmentContract: kind === 'external' ? { dictionary: 'SEARCH_EVAL_DICTIONARY_PATH', disableSecondary: 'SEARCH_EVAL_DISABLE_SECONDARY_SPLIT', dictionaryLoadTime: 'LazyLock: first Chinese tokenization in each process' } : null };
await mkdir(path.dirname(output), { recursive: true });
if (options.prepareOnly) {
  const prepared = path.join(cache, 'engines', `${kind}-prepared.json`);
  await writeFile(prepared, JSON.stringify(metadata, null, 2) + '\n'); console.log(JSON.stringify({ prepared, source, override: override?.directory }));
} else {
  const cargoArgs = [`+${toolchain}`, 'build', '--release', '--locked', '-p', 'meilisearch', '--no-default-features', '--features', 'chinese', '--target', target, '--target-dir', targetDir, '--manifest-path', path.join(source, 'Cargo.toml')];
  if (override) cargoArgs.push('--config', `paths=${JSON.stringify([override.directory])}`);
  const start = Date.now(); run('cargo', cargoArgs); await verifySource();
  const built = path.join(targetDir, target, 'release', `meilisearch${suffix}`);
  const bytes = await readFile(built); const versionOutput = run(built, ['--version'], { capture: true });
  if (versionOutput !== 'meilisearch 1.53.2') throw Error(`Unexpected built version: ${versionOutput}`);
  await copyFile(built, output);
  const manifest = { ...metadata, completedAt: new Date().toISOString(), elapsedMs: Date.now() - start, command: ['cargo', ...cargoArgs], binary: { path: output, sha256: hash(bytes), bytes: (await stat(output)).size, versionOutput } };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n'); console.log(JSON.stringify({ binary: output, manifest: manifestFile, sha256: manifest.binary.sha256 }));
}

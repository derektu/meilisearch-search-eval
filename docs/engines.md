# Engines and tokenizer helper

The public repository contains patch/build instructions and evaluation code. It does not contain a Meilisearch executable, a COCT download, a converted dictionary, Cargo build output, or a copy of upstream source. Those remain under ignored `.cache/` / `target/` directories. Obtaining a dataset for local research does not grant permission to redistribute it.

## Baseline contract

| ID | Text normalization | Engine | Secondary splitting | Fragment reference |
| --- | --- | --- | --- | --- |
| B0 | off | stock | stock behavior | off |
| B1 | on | same stock | same stock behavior | off |
| B2 | on | external-dictionary engine | on (`0`) | off |
| B3 | on | same external engine and dictionary | off (`1`) | off |
| B4 | on | same as B3 | off (`1`) | on |

`baselines/B0.json` through `B4.json` declare these controls. `${DICTIONARY_PATH}` is an explicit placeholder for an absolute local file; it is not a URL and does not trigger a download. The runner expands and records its effective strategy. These files describe experiments; changing one does not turn an incompatible result into a passing test.

B0/B1 accept any explicitly supplied compatible stock binary path. Record its bytes, SHA-256, version, and provenance. An official all-language release and an unmodified source build with only the `chinese` feature must be identified separately. B2/B3 use one binary and one dictionary hash; only `SEARCH_EVAL_DISABLE_SECONDARY_SPLIT` changes. B4 is a reference retrieval layer, not an alternative Meilisearch ranking engine.

## Build the external-dictionary research engine

Requirements: Node.js with `fetch`, Git, `tar`, rustup/Rust **1.91.1**, and the native C/C++ linker/toolchain required by Meilisearch on the build platform. The build downloads official source and Cargo dependencies. A clean first build can be substantial.

From the repository root:

```sh
npm run engine:build
```

The default output is `.cache/engines/meilisearch-coct-external` (`.exe` on Windows), with an adjacent `<binary>.manifest.json`. Despite the filename, **no COCT data is compiled into this executable**. It loads an explicitly supplied Jieba-format file at runtime.

Useful options:

```sh
# Validate and record the local dictionary identity in the build manifest.
npm run engine:build -- --dictionary /absolute/path/to/coct-news.txt

# Reuse an existing Cargo target directory without hardcoding it in public scripts.
npm run engine:build -- --target-dir /absolute/path/to/cargo-target

# Fetch/verify source and prepare the isolated patch without compiling.
npm run engine:build -- --prepare-only

# Optional unmodified chinese-only source-build control.
npm run engine:build -- --kind stock
```

`--target <Rust-triple>` overrides the native Rust host target. `--toolchain <version>` is recorded and defaults to 1.91.1. The script runs the resulting binary's `--version`, so this entry point expects a target executable on the current host; it does not claim arbitrary cross-compilation support. Building each native platform requires that platform's toolchain. A different toolchain or target is a distinct build, even if the reported Meilisearch version is unchanged.

### Pinned primary sources

- [Meilisearch 1.53.2 commit ec006cecec6f684b1dcaee093a45ab4c05707127](https://github.com/meilisearch/meilisearch/tree/ec006cecec6f684b1dcaee093a45ab4c05707127).
- Its [Cargo.lock](https://github.com/meilisearch/meilisearch/blob/ec006cecec6f684b1dcaee093a45ab4c05707127/Cargo.lock), SHA-256 `f884034e00ae026ecc9a3c15999b11857dff4a99ba8d7c0528626571627cefbf`, selects **Charabia 0.10.0** and **jieba-rs 0.10.3**.
- [Official Charabia 0.10.0 crate archive](https://static.crates.io/crates/charabia/charabia-0.10.0.crate), SHA-256 `27d98f4c66de52108210ee491c9c991513021dfd259bf65e4bbd889687b488d7`, checked against that lockfile.

`tools/engine/build.mjs` checks out the exact Meilisearch commit into `.cache/engine-build/source/`, refuses dirty/mismatched source, verifies the lockfile and crate checksum, extracts Charabia into an isolated directory, then applies `tools/engine/charabia-external-dictionary.patch`. It copies the shared `dictionary.rs` validator into that isolated crate. Cargo uses a **paths override** with `--locked`, `--no-default-features --features chinese`; neither Meilisearch's tracked source nor Cargo's shared registry source is patched.

An optional `--target-dir` is a build cache, not source identity. Upstream source, archive, patch, validator, isolated Chinese segmenter, target, toolchain, build command, elapsed time and final executable identity are recorded. If `--dictionary` is supplied, its hash, byte size, entry count and zero-frequency count are recorded too; it is still not embedded. Evaluation manifests must additionally record the file actually used at runtime. Source pinning is not a claim of bit-for-bit identical outputs across operating systems, linker versions or arbitrary Cargo environment configuration.

If a verified cache is modified, the script stops instead of silently replacing the contents. Preserve/investigate it before removing the relevant ignored cache directory and retrying. Downloads/build failures do not produce a new successful manifest.

## Runtime configuration and dictionary format

```sh
SEARCH_EVAL_DICTIONARY_PATH=/absolute/path/to/coct-news.txt \
SEARCH_EVAL_DISABLE_SECONDARY_SPLIT=0 \
.cache/engines/meilisearch-coct-external <normal-Meilisearch-options>
```

On Windows set the same environment variables in PowerShell and invoke the `.exe`. The evaluator normally supplies these variables to its isolated child process.

- `SEARCH_EVAL_DICTIONARY_PATH` is required and must be absolute. There is no bundled fallback.
- `SEARCH_EVAL_DISABLE_SECONDARY_SPLIT=0` retains the upstream Charabia `cut_for_search` secondary splitting. `1` skips it while retaining Jieba `cut(text, false)` (HMM disabled). An unset flag means `0`; other values are errors.
- UTF-8 dictionary lines are `word frequency [tag]` with two or three whitespace-separated fields. Blank lines are ignored. A word containing spaces is not representable in this format.
- Frequencies are unsigned integers fitting the target's `usize`. **An individual zero-frequency entry is valid** and is passed through unchanged. A file with no entries or no positive-frequency entry is rejected. Zero does not mean “automatically assign frequency one”; conversion/flooring belongs to the dataset policy and must be reported there.
- This loader does not normalize, deduplicate, scale, floor, convert scripts or expand synonyms. Supply the same frozen prepared dictionary to B2/B3/B4.

Both the dictionary and split flag are process-wide `LazyLock` values. The dictionary is read at **first Chinese tokenization**, not when the HTTP health endpoint first succeeds. Missing/unreadable/malformed input fails at that point; a healthy server alone does not prove dictionary loading worked. After a failure or after changing the file/flag, restart the process. Changing a file does not retokenize an existing Meilisearch index: the controlled runs use fresh databases/reindexing and record the dictionary hash. No hot reload or index migration is implemented.

## Rust helper used by the fragment reference

See [tools/tokenizer/README.md](../tools/tokenizer/README.md). The Cargo package/bin is **`search-eval-tokenizer`**, and the root `npm run tokenizer:build` produces `tools/tokenizer/target/release/search-eval-tokenizer` (`.exe` on Windows).

The helper's only direct dependencies are pinned `jieba-rs = 0.10.3` (default dictionary feature disabled) and `serde_json = 1.0.145`, with a committed Cargo.lock. It reads `{"texts":[...]}` from stdin, requires `--dict ABS_PATH`, and emits one array per input as `{"tokens":[[{"word":"…","startByte":0,"endByte":3}]]}`. Every whitespace and punctuation token remains present. Offsets are half-open UTF-8 bytes and are checked for complete contiguous input coverage. It uses the same external-format validator as the research engine and does not embed a lexicon.

This helper is Jieba's **base** segmentation, without Charabia's secondary splitting. The reference evaluator decides how to coalesce adjacent single Han characters; that behavior is separate from Meilisearch's own query processing. A successful helper call does not establish end-to-end search relevance.

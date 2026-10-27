# Jieba token spans for the reference evaluator

This helper runs **jieba-rs 0.10.3 `cut(text, false)`** against an explicit external dictionary. It has no embedded default dictionary, performs no normalization or Charabia secondary splitting, and never removes whitespace or punctuation. The evaluator supplies already-normalized text when needed.

Build from the repository root (Rust 1.91.1):

```sh
cargo +1.91.1 build --release --locked --manifest-path tools/tokenizer/Cargo.toml --target-dir .cache/tokenizer-target
.cache/tokenizer-target/release/search-eval-tokenizer --dict /absolute/dictionary.txt < input.json
```

Windows uses the `.exe` suffix. `cargo test --locked --manifest-path tools/tokenizer/Cargo.toml --target-dir .cache/tokenizer-target` checks the shared dictionary validator.

Input is one JSON object, read to EOF:

```json
{"texts":["台積電， A B", ""]}
```

Output has one token array per input string:

```json
{"tokens":[[{"word":"台積電","startByte":0,"endByte":9},{"word":"，","startByte":9,"endByte":12},{"word":" ","startByte":12,"endByte":13},{"word":"A","startByte":13,"endByte":14},{"word":" ","startByte":14,"endByte":15},{"word":"B","startByte":15,"endByte":16}],[]]}
```

That example assumes the external dictionary selects 台積電 as one word; actual boundaries depend on its words and frequencies. Offsets are half-open **UTF-8 bytes**, not JavaScript UTF-16 indexes. Concatenating token words reproduces each input exactly, and coverage is checked before output. Errors go to stderr and exit 2; stdout contains only the JSON result (or explicit `--help` text).

Dictionary format is UTF-8 `word frequency [tag]`, with two or three whitespace-separated fields per nonblank line. Frequencies are nonnegative integers fitting `usize`: **individual zero-frequency entries are accepted without alteration**, but the file needs at least one positive entry. No frequency scaling, flooring, conversion, merging, normalization or synonym expansion occurs here. Words containing spaces cannot be represented in this format. The engine and helper share `tools/engine/dictionary.rs` validation.

The helper reports Jieba's base tokens. The B4 evaluator may coalesce adjacent single Han characters using these spans; that reference behavior does not change Meilisearch's tokenizer or ranking. Dictionary licensing and provenance remain the user's responsibility; no COCT data is shipped.

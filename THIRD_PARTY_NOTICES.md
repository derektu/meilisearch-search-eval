# Third-party sources

The repository's MIT license covers its own evaluation code, documents and synthetic fixtures. It does not relicense external engines, dictionaries, corpora or dependencies.

- Text conversion uses pinned [opencc-js 1.4.2](https://github.com/nk2028/opencc-js), under its MIT license and included notices. npm installs the package separately.
- The query-tokenizer helper uses [jieba-rs 0.10.3](https://github.com/messense/jieba-rs) and serde_json through Cargo; their source and license notices remain with the dependencies.
- The experimental engine is built from the fixed [Meilisearch source](https://github.com/meilisearch/meilisearch/tree/ec006cecec6f684b1dcaee093a45ab4c05707127) and [Charabia 0.10.0](https://crates.io/crates/charabia/0.10.0). The patch does not replace their upstream licenses. This repository does not distribute those binaries or a vendored copy of upstream source.
- COCT source and derived lexicons are acquired explicitly into ignored local storage. No product redistribution license has been established here. Acquisition and checksum validation do not grant additional rights.
- Real-document manifests identify public source URLs and snapshot hashes. Full news text, titles and video subtitles remain outside version control. Obtain permission appropriate to any corpus you redistribute.

See [dataset documentation](docs/datasets.md) and [engine provenance](docs/engines.md) for exact versions, preparation and limitations.

# Third-party sources

The repository's MIT license covers its own evaluation code, documentation and authored synthetic fixtures. Third-party engines, conversion data, dictionaries and source texts retain their respective rights and license terms.

## Search-text corpus

[`datasets/real-34/dataset.json`](datasets/real-34/dataset.json) contains the fixed `real-34-v1` search-text corpus: 34 source titles, publisher identifiers/names and stored text snapshots, with stable attribution URLs and publication/collection dates. All stored text is present without additional truncation or summarization. Ten source snapshots are summaries; these are not represented as complete source articles. Twenty-four source snapshots are marked as full text.

[`source-manifest.json`](datasets/real-34/source-manifest.json) identifies every source URL and records exact text/JSON hashes. The source texts and publisher names retain their original rights. Inclusion in this reproducible evaluation dataset does not apply this repository's MIT license to those texts or establish a general license for other uses. Source attribution and the source's applicable terms accompany use of the corpus.

## Text conversion

Text conversion uses pinned [opencc-js 1.4.2](https://github.com/nk2028/opencc-js), subject to its MIT license and included notices. npm installs the dependency separately. Its conversion rules and dictionaries are third-party material covered by the package's own notices.

## Tokenizer and search engine

The tokenizer helper uses [jieba-rs 0.10.3](https://github.com/messense/jieba-rs) and serde_json through Cargo. Their license notices remain with the dependencies.

The experimental engine uses fixed [Meilisearch source](https://github.com/meilisearch/meilisearch/tree/ec006cecec6f684b1dcaee093a45ab4c05707127) and [Charabia 0.10.0](https://crates.io/crates/charabia/0.10.0). The source patch does not replace upstream licenses. Official downloads, source builds and dependencies retain their own terms; generated binaries and upstream source are not included in the repository.

## COCT lexicon

The [National Academy for Educational Research download page](https://coct.naer.edu.tw/page.jsp?ID=41) provides the fixed [通用詞頻表 - 定稿1141208.xlsx](https://coct.naer.edu.tw/file/files/%E9%80%9A%E7%94%A8%E8%A9%9E%E9%A0%BB%E8%A1%A8%20-%20%E5%AE%9A%E7%A8%BF1141208.xlsx). The acquisition tool verifies its SHA256 and produces a deterministic news-frequency lexicon in `.cache/lexicons/`.

The source and derived COCT lexicons are obtained through that explicit procedure and are not included in this repository. The download page does not establish a product redistribution or derivative-data license for this table. Acquisition, conversion and checksum validation do not grant additional rights. The file date is not a statement of corpus collection dates.

Exact versions, hashes and preparation appear in [dataset documentation](docs/datasets.md). Engine distribution/build provenance and controls appear in [engine documentation](docs/engines.md).

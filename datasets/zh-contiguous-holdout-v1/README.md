# 連續片段固定測資

26份自編文件、46個查詢，包含63組正例及1133組封閉世界負例。完整詞以引號要求連續，片段需字面連續，明確空白代表AND；另有繁簡／NFKC、Latin prefix與typo、中英混合條件。

所有title、publisher與body均在[dataset.json](dataset.json)內；[source manifest](source-manifest.json)固定全文與gold的hash，[queries.json](queries.json)提供獨立查詢檔。文件是合成案例，不代表真實語料的相關性分布。

此組是可公開重跑的功能基準。未見保留集須在每次研究另行凍結，不以已公開或用來調參的測資宣稱獨立盲測。

在repo根目錄執行：

```sh
node tools/datasets/verify-corpus.mjs datasets/zh-contiguous-holdout-v1
npm run eval:matrix -- --dataset datasets/zh-contiguous-holdout-v1/dataset.json \
  --port <free-port> --out results/contiguous-holdout-run-1
```

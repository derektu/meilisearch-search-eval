# meilisearch-search-eval

可重跑的中文搜尋評測：固定測資，分別比較文字正規化、外部詞庫、二次切分與連續片段查詢。供 XS team 與其他搜尋實作共用；初版以 Meilisearch 為主，未綁定 XR Collector 的內部程式。

比較單位是完整搜尋方案，包含引擎、詞庫、正規化、查詢策略及排序設定。**B4 是參考實驗，尚未完成產品整合。**

## 比較組

| 組別 | 設定 | 用途 |
| --- | --- | --- |
| B0 | 預設中文引擎，未加正規化 | 原始行為 |
| B1 | B0＋文字正規化 | 隔離正規化的影響 |
| B2 | B1＋外部 COCT 詞頻主庫 | 隔離詞庫的影響 |
| B3 | B2＋保留第一輪完整詞界 | 隔離二次切分的影響 |
| B4 | B3＋連續片段補召回與驗證 | 片段查詢參考實驗 |

B0/B1 的「預設引擎」指未修改預設中文詞庫與切分的固定 Meilisearch 版本；本輪可用保留中文功能的 build。B2–B4 使用相同外置詞頻檔、相同實驗 binary，透過設定切換策略。原先「全量 dictionary API」實驗另列診斷結果，不屬於 B0–B4。

所有組別都要保存實際版本、binary／詞庫／測資 hash；不能把不同設定的結果直接合併成同一 baseline。

## 測資與公開範圍

- [zh-semantics-v1](datasets/zh-semantics-v1/dataset.json)：23 份自建文件、22 題、38 組正例及 468 組明確負例。包含完整詞、分散字負例、片段、單字、多詞、引號及正規化。
- [real-34](datasets/real-34/source-manifest.json)：原34份真實文件的來源 manifest，另保留60題查詢。第三方新聞／字幕全文不放入本 repo；在本機匯入原始快照後執行。
- COCT 原始資料及衍生詞庫不隨 repo 散布。提供固定版本的取得／轉換程序，輸出留在被忽略的 `.cache/`。
- 目前兩組資料都是已用於研究的開發／回歸集，**沒有宣稱它們是未見過的 holdout**。後續保留集需獨立建立。

詳見[測資格式與取得方式](docs/datasets.md)、[評測方法與限制](docs/methodology.md)。

## 開始使用

需要 Node.js 22+。B0/B1 另需相容 Meilisearch binary；建立實驗引擎及 B4 tokenizer 時需 Rust/Cargo、Git 與對應平台的編譯工具。COCT 解析工具需 Python 3。

```sh
npm ci
npm run verify
```

取得固定 COCT、建立實驗引擎及 tokenizer：

```sh
npm run lexicon:coct
npm run engine:build
npm run tokenizer:build
```

COCT 的檔案版本不等於語料統計年份；公開下載也不代表已確認產品再散布授權。[引擎建置、外部詞庫與參數](docs/engines.md)會說明每個步驟與首次載入限制。

## 執行比較

每次執行必須使用新輸出目錄及可用的本機 port；由你所在環境的 port 管理方式分配。runner 僅啟動及停止自己的引擎程序，使用隔離資料庫，API dictionary 固定空白。

以下 `<port>`、`<stock-binary>`、`<external-binary>`、`<dictionary>` 與 `<tokenizer>` 都必須換成你的實際值。macOS/Linux tokenizer通常位於 `tools/tokenizer/target/release/search-eval-tokenizer`；Windows加上 `.exe`。

```sh
npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B0 --binary <stock-binary> --port <port> --out results/semantics-B0

npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B1 --binary <stock-binary> --port <port> --out results/semantics-B1

npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B2 --binary <external-binary> --dictionary <dictionary> \
  --port <port> --out results/semantics-B2

npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B3 --binary <external-binary> --dictionary <dictionary> \
  --port <port> --out results/semantics-B3

npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B4 --binary <external-binary> --dictionary <dictionary> \
  --tokenizer <tokenizer> --port <port> --out results/semantics-B4

npm run eval -- compare \
  --runs results/semantics-B0,results/semantics-B1,results/semantics-B2,results/semantics-B3,results/semantics-B4 \
  --out results/semantics-comparison.json
```

執行輸出包含逐題 ID／排名／位置、正例漏查、明確負例誤收、排序案例及時間。原始輸出留在 `results/`，預設不進版控；分享前移除環境路徑並核對資料權利。報告不能將未標註結果當成不相關，也不能把 B4 記憶體處理時間和其他組完整 HTTP 延遲混在一起比較。

## 更新測資或加入其他實作

測資以獨立JSON與manifest維護，修改文件、query或gold時更新資料版本，不在評測程式內針對題目補答案。新增實作時透過adapter接入；沿用相同的文件、查詢與評分規則，保留引擎專屬設定。

目前 adapter 是本機 managed Meilisearch。未來可加入 XS team 的參考實作；不需要為此先擴成通用benchmark框架。

已完成的獨立重跑結果見 [首輪 B0–B4 報告](reports/bootstrap-2026-10-27/README.md)。歷史研究結果保存在 [reports/historical](reports/historical/README.md)，與本 repo 重新執行的結果分開。規模效能與獨立保留集驗證是後續研究工作，不列入 XR Collector #162 的結案前置。

## 授權

本 repo 自建程式、文件與合成測資採 [MIT](LICENSE)。外部引擎、OpenCC、COCT及其他第三方資料各自適用原始條款；本 repo 的 MIT 不會替它們重新授權。建置出的 binary、外部詞庫與真實語料不提交。

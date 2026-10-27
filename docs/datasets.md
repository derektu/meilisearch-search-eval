# 測資與來源界線

本倉庫公開自寫合成測資、查詢／gold、來源 manifest、雜湊與聚合研究結果。第三方新聞、YouTube 字幕與授權未釐清的 COCT 原始／衍生詞表只放在 ignored `.cache/`，不隨 Git 分享。根目錄 MIT LICENSE 不替第三方來源授權。

## zh-semantics-v1

[datasets/zh-semantics-v1/dataset.json](../datasets/zh-semantics-v1/dataset.json) 是自寫合成開發集，包含 23 文件、22 查詢、38 expected pairs、468 forbidden pairs，以及一組排序與三組探索查詢。每個查詢完整標註 23 份文件；expected 與 forbidden 互斥且覆蓋全部文件。

它保留原研究 suite 的文件與 gold，只增加 `schemaVersion: 1`、dataset id 與說明；因此整包檔案的新 SHA256 與歷史原 suite 不同，不能拿整檔雜湊冒充原始版本。

```sh
node tools/datasets/validate.mjs datasets/zh-semantics-v1/dataset.json
```

格式見 [schema.json](../datasets/schema.json)。文件至少有 `id/title/bodyMarkdown/publisher:{id,name}`，可帶 SavedDocument 的其他欄位。查詢至少有 `id/query/expectedIds/forbiddenIds`；`expectZero`、`rankingCases`、`exploratoryQueries` 為可選欄位。驗證工具另檢查 ID 唯一、引用存在與 gold 不矛盾。

## real-34

[datasets/real-34/source-manifest.json](../datasets/real-34/source-manifest.json) 記錄 2026-10-27 研究 snapshot 的 34 個來源 ID／URL、日期、欄位規格與內容 SHA256，沒有原始 title、正文、字幕或第三方摘錄。[queries.json](../datasets/real-34/queries.json) 公開 60 查詢與原有 gold，去除原本 evidence 中的第三方標題。

這批查詢有 **50 組 expected、0 組 forbidden、5 題 expectZero**。未被 expected 指定的文件不是自動判為不相關；只報 expected hit／miss 與明定的零命中條件，不能用空 forbidden 宣稱完整 precision。這是已用於調查的開發資料，不是獨立 holdout。

持有原始 SavedDocument snapshot 且可在本機使用者，明確指定檔案導入：

```sh
node tools/datasets/import-local.mjs --documents /path/to/real-documents.json
# 可選：同時驗證舊查詢快照，或本倉庫公開 queries.json。
node tools/datasets/import-local.mjs --documents /path/to/real-documents.json --queries /path/to/real-queries.json
node tools/datasets/validate.mjs .cache/datasets/real-34/dataset.json
```

工具不掃描其他資料夾、不抓網頁、不下載字幕。它驗證文件陣列與各文件的 JSON SHA256、數量、ID／順序，以及公開查詢 SHA256；`--queries` 有提供時也驗證原始或公開版本。JSON hash 定義為 UTF-8 `JSON.stringify`、不縮排且保留物件 key 順序；另記原檔 byte hash 供 provenance，不要求相同縮排。資料不符就拒絕導入。輸出固定留 `.cache/`；即使給 `--output` 也不能寫入公開資料目錄。

來源 URL 是識別與回溯資訊，**重新抓相同 URL 不保證得到原 snapshot**。新聞摘要、網站修改、字幕版本及正規化前原文都可能不同。其他人沒有原始 snapshot 時，可以直接跑公開合成集，或建立權利清楚、另有 dataset id 的新測資；不可填入相同 real-34 id 假裝重現。

## COCT 新聞詞頻主庫

官方入口：[國教院通用詞頻表下載頁](https://coct.naer.edu.tw/page.jsp?ID=41)。原始檔固定為 `通用詞頻表 - 定稿1141208.xlsx`，SHA256：

```text
bfd3b73938e115ae39a44c5e11c97135c09939cf598157cb2fe0b33c4302de75
```

2025-12-08 是這個檔案的版本／HTTP 最後修改時間，沒有據此推論語料蒐集期間。查核時未找到這份詞頻表明確的產品衍生／再散布授權；公開下載不等於已有開放授權。需自行確認適用條款，詞表不隨本倉庫發佈。

安裝 Node dependency 後顯式執行：

```sh
npm ci
node tools/datasets/fetch-coct.mjs
# Python 3 不在預設 PATH 時：
PYTHON=/path/to/python3 node tools/datasets/fetch-coct.mjs
```

下載／既有 cache 都先驗原始 XLSX SHA256。Python 僅用標準庫 `zipfile`／`xml.etree.ElementTree.iterparse` 串流讀工作表，沒有 openpyxl 或 pandas 依賴；抽取 `通用詞頻表` 的 B 欄詞、I 欄新聞 raw count，檢查標頭與 163,701 詞。Node 使用 [src/normalize.mjs](../src/normalize.mjs) 的同一正規化函式（OpenCC 1.4.2），碰撞詞的新聞 count 加總，最後零值取 1；`n` 是 jieba 格式的未使用 POS 佔位。沒有讀 query/gold 或依失敗題選詞。

結果位於 `.cache/lexicons/coct-1141208/`：

| 檔案 | 用途 |
| --- | --- |
| `source.xlsx` | 17,303,267-byte 官方下載 snapshot |
| `raw.jsonl` | 詞／新聞 raw count，中間產物 |
| `coct-news.txt` | jieba `word frequency n` 主庫格式 |
| `terms.json` | 同批詞頭，僅供獨立 dictionary API 診斷等用途 |
| `manifest.json` | 來源、欄位、正規化、頻率及輸出雜湊 |

轉換得到 **162,966 不同詞、730 組碰撞、439 個零頻取 1、0 拒收**。`coct-news.txt` 是 2,212,252 bytes，預期 SHA256：

```text
4b2d026eaa353ffde900f36049e72f1fa6902fbf25b14dbcb0b675d541e01264
```

不符合固定數量／雜湊即失敗，不悄悄接受上游更新或新正規化結果。若要換資料或頻率政策，應建立新詞庫 id／manifest，再重新比較。

## 歷史報告

[reports/historical/2026-10-27.json](../reports/historical/2026-10-27.json) 只保留舊實驗的聚合 metrics、文件 ID 排名差異與來源雜湊，未包含第三方正文、snippet、憑證或使用者路徑。對應說明見 [歷史方法](../reports/historical/2026-10-27.md)。它不是新倉庫執行的結果。

持有舊完整 artifact 時，可用白名單 exporter 重建同一公開摘要：

```sh
python3 tools/datasets/export-historical.py /path/to/ticket-artifacts/162
```

該工具僅抽取明確允許的欄位，不整包複製 raw JSON。新實驗結果應保留獨立 run id、來源版本與實際執行時間，不能覆寫歷史來源來宣稱已重跑。

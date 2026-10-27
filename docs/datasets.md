# 測資與詞庫

兩組搜尋測資都包含在倉庫內。Clone 後可直接以固定文本、查詢與 gold 執行 B0–B4。COCT 詞庫透過固定官方下載連結、來源 SHA256 與轉換程序取得；輸出保存在 `.cache/lexicons/`。

## zh-semantics-v1

[datasets/zh-semantics-v1/dataset.json](../datasets/zh-semantics-v1/dataset.json) 是自寫合成開發集，包含 23 文件、22 查詢、38 expected pairs、468 forbidden pairs、一組排序案例及三組探索查詢。每個正式查詢完整標註 23 份文件；expected 與 forbidden 互斥且覆蓋全部文件。

案例涵蓋完整詞、詞內連續片段、單字、多詞 AND、引號片語與文字正規化。探索查詢沒有 gold，不計入 pass／fail。

```sh
node tools/datasets/validate.mjs datasets/zh-semantics-v1/dataset.json
```

## real-34-v1

[datasets/real-34/dataset.json](../datasets/real-34/dataset.json) 包含 34 份中文／英文新聞與影片搜尋文本、60 查詢及 gold，dataset id 為 `real-34-v1`、version 為 `1`。每份文件包含：

| 欄位 | 內容 |
| --- | --- |
| `id` | 穩定文件 ID，供 gold 與排名引用 |
| `title` | 完整快照標題 |
| `bodyMarkdown` | 完整固定搜尋文本，保留所有字元與換行 |
| `publisher.id/name` | 來源識別與名稱 |
| `sourceType/sourceUrl` | 來源類型及可回溯 URL |
| `publishedAt/collectedAt` | 發布與快照收集時間 |

快照有 24 份來源標為完整文本、10 份來源提供摘要。`bodyMarkdown` 完整保留各份快照的搜尋文本；來源摘要不是網站文章全文。資料集不在執行時重新下載文章或字幕，避免頁面與字幕變動改變測量輸入。

[source-manifest.json](../datasets/real-34/source-manifest.json) 記錄 dataset 檔案 SHA256、文件／查詢 JSON SHA256、逐份來源 URL、文本形態，以及 title、bodyMarkdown、publisher 的完整性雜湊。[queries.json](../datasets/real-34/queries.json) 提供同一份查詢／gold 的獨立入口。

查詢共 **50 組 expected、0 組 forbidden、5 題 expectZero**。未被 expected 指定的文件不是自動判為不相關；這批標註只支持已知正例 miss 與零命中條件的評估，不能據此計算完整 precision。`SearchEvalMissingTokenQzxv791` 是無命中控制查詢。

```sh
node tools/datasets/validate.mjs datasets/real-34/dataset.json
```

新聞與字幕文本的權利屬各原始來源，來源連結與標示見 manifest 及 [第三方聲明](../THIRD_PARTY_NOTICES.md)。本倉庫 MIT LICENSE 不替第三方文本授權。

## 格式與版本

格式見 [schema.json](../datasets/schema.json)。Dataset 至少有 `schemaVersion: 1`、`id`、`documents` 與 `queries`。文件至少有 `id/title/bodyMarkdown/publisher:{id,name}`；查詢至少有 `id/query/expectedIds/forbiddenIds`。`expectZero`、`rankingCases`、`exploratoryQueries` 為可選欄位。

驗證工具檢查 ID 唯一、引用存在、gold 不矛盾與排序案例的候選引用。資料變更使用明確的 dataset version／id，結果 manifest 記錄實際檔案 SHA256。檔案 SHA256 使用完整 UTF-8 bytes；JSON SHA256 使用 UTF-8 `JSON.stringify`、不縮排且保留 key 順序；文本 SHA256 使用原字串的 UTF-8 bytes。

## COCT 新聞詞頻主庫

官方入口為 [國教院通用詞頻表下載頁](https://coct.naer.edu.tw/page.jsp?ID=41)。固定來源檔為 [通用詞頻表 - 定稿1141208.xlsx](https://coct.naer.edu.tw/file/files/%E9%80%9A%E7%94%A8%E8%A9%9E%E9%A0%BB%E8%A1%A8%20-%20%E5%AE%9A%E7%A8%BF1141208.xlsx)，SHA256：

```text
bfd3b73938e115ae39a44c5e11c97135c09939cf598157cb2fe0b33c4302de75
```

2025-12-08 是檔案版本／HTTP 最後修改時間，不代表語料蒐集期間。官方下載頁沒有這份詞頻表明確的產品衍生／再散布授權標示；公開取得不等於可重新授權。倉庫提供固定取得程序，不包含 COCT 原始或衍生詞表。

```sh
npm ci
node tools/datasets/fetch-coct.mjs
# Python 3 不在預設 PATH 時：
PYTHON=/path/to/python3 node tools/datasets/fetch-coct.mjs
```

下載與既有 cache 都先驗 XLSX SHA256。Python 僅用標準庫 `zipfile`／`xml.etree.ElementTree.iterparse` 串流讀取工作表，沒有 openpyxl 或 pandas 依賴；抽取 `通用詞頻表` 的 B 欄詞、I 欄新聞 raw count，檢查標頭與 163,701 詞。

Node 使用 [src/normalize.mjs](../src/normalize.mjs) 的同一正規化函式及 OpenCC 1.4.2。碰撞詞的新聞 count 加總，最後零值取 1；`n` 是 jieba 格式的未使用 POS 佔位。準備程式不讀 query/gold，不依失敗題選詞。

結果位於 `.cache/lexicons/coct-1141208/`：

| 檔案 | 用途 |
| --- | --- |
| `source.xlsx` | 17,303,267-byte 官方下載快照 |
| `raw.jsonl` | 詞／新聞 raw count，中間產物 |
| `coct-news.txt` | jieba `word frequency n` 主庫格式 |
| `terms.json` | 同批詞頭，供獨立 dictionary API 診斷等用途 |
| `manifest.json` | 來源、欄位、正規化、頻率及輸出雜湊 |

固定轉換得到 **162,966 不同詞、730 組碰撞、439 個零頻取 1、0 拒收**。`coct-news.txt` 為 2,212,252 bytes，預期 SHA256：

```text
4b2d026eaa353ffde900f36049e72f1fa6902fbf25b14dbcb0b675d541e01264
```

數量或雜湊不符時程序失敗。不同來源資料、頻率政策或正規化規則使用不同詞庫 id／manifest，避免將不同輸入當成同一比較。

## 執行與報告

引擎取得、控制組與建置見 [engines](engines.md)，評估語意與解讀範圍見 [methodology](methodology.md)。執行入口、參數及公開報告見根目錄 [README](../README.md)。結果 manifest 固定 dataset、binary、詞庫與 runner source 的 SHA256，並在執行前後驗證一致。

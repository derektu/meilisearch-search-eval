# meilisearch-search-eval

中文搜尋流程的參考方案與可重跑評測。固定文件、查詢與相關性標註，分別比較文字正規化、詞庫、二次切分與連續片段查詢。

## 搜尋方案

| 組別 | 引擎與流程 | 比較目的 |
| --- | --- | --- |
| B0 | 官方 Meilisearch 1.53.2 community release，無正規化 | 官方預設行為 |
| B1 | 相同官方 release＋文字正規化 | 正規化的影響 |
| C1 | 同版本 Chinese-only source build＋正規化 | 官方發行版與自行建置的控制組 |
| B2 | Chinese-only＋正規化＋外部 COCT 詞頻主庫 | 與 C1 比較詞庫／載入策略 |
| B3 | B2＋保留第一輪完整詞界 | 二次切分的影響 |
| B4 | B3＋連續片段補召回與驗證 | 片段查詢參考方案 |

B0／B1 驗證官方 release 的固定 SHA-256，不能用 Chinese-only binary 代替。C1 與 B2 使用相同上游 source、toolchain、target及 Chinese-only features，供詞庫對照；B1→B2 同時改變建置與詞庫，不直接歸因為詞庫效果。

**B4 是記憶體參考方案。** 它能獨立補召回並驗證連續性；儲存、更新、合併排序及大規模效能需要另外驗證。各組設定在 [baselines](baselines/B0.json)，評測契約見[方法說明](docs/methodology.md)。

## 使用者看得到的差異

| 調整 | 例子 | 主要作用 |
| --- | --- | --- |
| B1 統一寫法 | `ＡＩ／AI`、`台积电／台積電`、`臺／台` | 不同字形使用同一搜尋表示 |
| B1 整理空白 | `台積電　 法說`等同`台積電 法說` | 整理分隔格式，保留字間空白 |
| B2 使用COCT | `觀光`不靠`直觀…賣光`命中 | 減少常見詞被拆字後的誤查 |
| B3 保留完整詞 | `台積電`不再拆成`台積／電` | 保留詞界；本次沒有單獨增加通過題數 |
| B4 支援連續片段 | `導體→半導體`、`金→現金流量` | 補回詞內搜尋，排除分散字匹配 |
| C1 精簡建置 | 本測資輸出與B1相同 | 控制建置差異，不代表品質或速度提升 |

完整例子及取捨見[淺顯說明](docs/plain-language.md)。

## 測資

Repo 包含執行所需的固定搜尋文本：

- [zh-semantics-v1](datasets/zh-semantics-v1/dataset.json)：23 文件、22 查詢、38 組正例與468 組明確負例，涵蓋完整詞、片段、分散字負例、單字、多詞、引號與正規化。
- [real-34-v1](datasets/real-34/dataset.json)：34 文件的完整固定搜尋文本、60 查詢與50 組正例。標題、來源名稱與正文直接存於 repo，來源與內容hash見 [source manifest](datasets/real-34/source-manifest.json)。其中24筆來源為full、10筆為summary；評測使用檔案內保存的完整輸入，不重新抓網頁或字幕。

兩組皆為開發／回歸集。獨立保留集與規模效能測試分開維護。未標註的文件不自動視為不相關。

COCT 詞頻表使用固定[官方 XLSX 連結](https://coct.naer.edu.tw/file/files/%E9%80%9A%E7%94%A8%E8%A9%9E%E9%A0%BB%E8%A1%A8%20-%20%E5%AE%9A%E7%A8%BF1141208.xlsx)，取得程序驗證原檔與轉換後hash。外部詞庫由引擎在執行時讀取，不嵌入binary。詳見[測資格式與COCT取得方式](docs/datasets.md)。

## 環境與建置

需要 Node.js 22+、Python 3、Git、tar、rustup／Rust 1.91.1與平台對應的C/C++編譯工具。

```sh
npm ci
npm run verify
rustup toolchain install 1.91.1 --profile minimal
npm run engine:download
npm run lexicon:coct
npm run engine:build -- --kind stock
npm run engine:build
npm run tokenizer:build
```

輸出檔案：

| 用途 | 路徑（Windows binary加`.exe`） |
| --- | --- |
| B0／B1 官方 release | `.cache/engines/meilisearch-official` |
| C1 Chinese-only source build | `.cache/engines/meilisearch-chinese-only` |
| B2–B4 外部詞庫引擎 | `.cache/engines/meilisearch-coct-external` |
| COCT 詞頻檔 | `.cache/lexicons/coct-1141208/coct-news.txt` |
| B4 tokenizer | `tools/tokenizer/target/release/search-eval-tokenizer` |

`--kind stock` 指未修改上游詞庫／切分程式的source build；它明確使用 `--release --locked --no-default-features --features chinese`，不代表官方release。版本、來源、checksum、target與toolchain見[引擎文件](docs/engines.md)。

## 執行評測

以下命令在repo根目錄執行。`<free-port>` 須替換成環境中分配的可用本機port；runner啟動自己的引擎與隔離資料庫，完成後清理。

```sh
npm run eval:matrix -- --dataset datasets/zh-semantics-v1/dataset.json \
  --port <free-port> --out results/semantics-run-1

npm run eval:matrix -- --dataset datasets/real-34/dataset.json \
  --port <free-port> --out results/real-run-1
```

每組執行一次首次查詢，再執行三輪暖查詢，分開保存時間。完整matrix包含B0、B1、C1、B2、B3、B4，並輸出逐題差異比較；輸出目錄必須不存在。

單一方案可直接指定：

```sh
npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B1 --binary .cache/engines/meilisearch-official \
  --port <free-port> --out results/single-B1

npm run eval -- run --dataset datasets/zh-semantics-v1/dataset.json \
  --baseline B4 --binary .cache/engines/meilisearch-coct-external \
  --dictionary .cache/lexicons/coct-1141208/coct-news.txt \
  --tokenizer tools/tokenizer/target/release/search-eval-tokenizer \
  --port <free-port> --out results/single-B4
```

分享報告：

```sh
node tools/export-report.mjs \
  --runs results/semantics-run-1/B0,results/semantics-run-1/B1,results/semantics-run-1/C1,results/semantics-run-1/B2,results/semantics-run-1/B3,results/semantics-run-1/B4 \
  --out reports/my-evaluation
```

[評測報告](reports/reference-2026-10-27/README.md)記錄方案、資料、結果與限制；機器可讀輸出保存每題ID／排名、漏查、明確負例誤收、版本及hash。B4的記憶體處理時間與引擎HTTP時間分開，不能混作端到端速度比較。

## 維護與擴充

測資以JSON獨立版控。文件、查詢或gold變動時使用不同資料版本；比較程序會拒絕同ID卻不同hash的資料。候選搜尋程式不讀gold來選擇結果。

其他搜尋實作可透過adapter接入相同文件、查詢與評分規則。完整搜尋方案的身分包含引擎、詞庫、正規化、查詢策略及排序設定，不能只依引擎名稱比較。

自建程式、文件與合成測資採 [MIT](LICENSE)；真實文本、COCT、外部引擎與dependencies各自適用其原始條款，見[來源說明](THIRD_PARTY_NOTICES.md)。

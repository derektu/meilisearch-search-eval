# 評估方法

比較單位是完整搜尋方案：引擎發行檔、文字正規化、詞頻主庫、二次切分、查詢策略與排序。固定 dataset 與 gold 分別量測 token、文件 membership、排序、位置映射與成本，讓各層結果可獨立解讀。

## 比較組與建置控制

| 組別 | 行為 |
| --- | --- |
| B0 | 官方 stock Meilisearch，不套應用文字正規化 |
| B1 | 同一官方 stock binary＋文字正規化 |
| B2 | 外置 COCT 新聞詞頻主庫＋正規化＋原 Charabia 二次切分 |
| B3 | 同一外置 COCT binary／詞庫＋正規化，停用二次切分，保留 Jieba 第一輪詞界 |
| B4 | B3＋獨立連續片段召回／驗證的記憶體參考層 |
| C1 | 同版本、同 toolchain／target／Chinese-only feature 的未修改主庫 source build＋正規化 |

C1 使用 Meilisearch 1.53.2／`ec006cecec6f684b1dcaee093a45ab4c05707127`、Rust 1.91.1，以及 `--no-default-features --features chinese`。它與 B2 的 source／target／toolchain／feature 相同，Charabia 外置主庫 patch 是控制差異。

B0→B1 觀察同一官方發行檔的正規化效果。B1→C1 包含官方 distribution 與本機 source build 的整體差異，不能只歸因於 feature。C1→B2 才能隔離外置詞庫／loader 策略；B2→B3 觀察二次切分，B3→B4 觀察片段參考層。官方 binary 的編譯 toolchain 不由本機 build 參數推論。

COCT 全詞頭送入 Meilisearch dictionary API 是獨立診斷方案，不屬 B0–B4；API 沒有頻率，也沒有替換 Jieba 主庫。

每組記錄上游 commit、Charabia／jieba-rs、feature／target／toolchain、binary SHA256、外置詞庫 SHA256，以及 dataset／設定／runner source SHA256。換檔載入、失敗行為與索引重建是各自的證據；執行中的熱更新需要獨立驗證。

## 正規化與詞頻

正規化為完整 NFKC、ASCII 小寫、OpenCC 1.4.2 s2t／t2tw 字形轉換、臺→台與 Unicode White_Space 合併／trim。來源顯示文本保留，搜尋字段使用固定轉換結果；不做公司別名、同義詞或地區用詞替換。

COCT 使用新聞 raw count；同正規化詞形的 count 加總後，零值取 1。政策對整份詞表一致，不從 query/gold 推導。來源檔案版本、語料統計期間與資料授權是不同資訊，見 [datasets](datasets.md)。

## Gold 與評估範圍

`zh-semantics-v1` 為 23 文件／22 查詢的合成開發集，包含 38 expected／468 forbidden。每個正式查詢完整標註文件集合。`real-34-v1` 為 34 固定文本／60 查詢的開發集，包含 50 expected、0 forbidden、5 題 expectZero。

兩組資料均供開發／回歸使用，沒有未見過的 holdout 成績。獨立保留集需凍結來源、文本與人工標註，並與當輪規則修正隔離。依某批失敗調參後，該批成績屬開發結果。

`expectedIds` 是應命中文件，`forbiddenIds` 是明定不得命中文件，`expectZero` 是整題不得有結果。未標註文件不等於不相關。real-34-v1 的標註支持已知正例 miss 與零命中違反，不支持完整 precision；合成集可逐題評估全部文件的 membership。

執行前固定資料與 hash。案例或期望變動使用明確 dataset 版本；不能把不同 gold 的分數當作同一資料改善。詞庫程序不讀 gold，不從失敗題挑詞來宣稱通用詞庫效益。

## 連續片段與多詞

每個查詢片段在同一搜尋欄位中連續出現。「半導」可命中「半導體」，不可用「半年」與「導師」分散拼字。「股」需能定位到「個股」內的股，同文件其他「股票」的股不能代替該位置的驗證。

多個明確查詢詞維持 AND，可在文件不同位置出現。COCT 已辨識的多詞，例如「觀光／產業」，維持多詞 AND；引號片語要求正規化原文連續。未收短片段若切成相鄰漢字單字，參考層合併這些字以保留連續性。此規則是候選查詢語意，不代表所有自然語句分詞都正確。

「岸風」跨「離岸／風電」詞界、買股等輸入、中文 fuzzy 與中英混合 typo／prefix 屬需要明訂或擴充標註的行為。沒有 gold 的探索題只報結果，不計 pass／fail。詞內片段與一般全文 substring 規則不能在未說明時互換。

## Membership、排序與位置

- Token probe 說明拆詞層次；Meilisearch 索引／查詢行為由真實引擎另外量測。
- Membership 使用完整文件 ID 集合，分開記錄 missing／forbidden／expectZero，避免把命中數減少當作品質提升。
- 正式查詢與探索查詢分開計數；探索輸出不加入通過率。
- 排名案例的兩個候選都須存在。缺少候選時不可評估，不能因完整詞獨佔 rank1 就通過。
- 位置檢查包含詞內目標位置、UTF-8 byte 與 UTF-16 原文範圍映射；固定案例通過的結論僅覆蓋這些案例。

## B4 參考層與時間

B4 使用 Unicode 首字 posting 加連續字面驗證，能獨立補回 B3 沒有的文件。含漢字查詢使用該層求候選；符合條件的引擎候選保留原排序，再追加補回者。這不是一般性的完整詞／片段打分規則；「導體」指定案例順序正確不能證明通用排名最佳。

real-34-v1 有 **26 個無漢字查詢**，B4 直接採用引擎的 ID／順序，保留其英文 typo 行為。這些成績不代表片段層獨立通過英文檢索驗證，也不涵蓋中英混合 typo／prefix。B4 是 benchmark 參考方案，不是 Meilisearch 原生排名能力或正式服務部署的驗收。

HTTP top20、完整 membership HTTP 與記憶體片段處理時間分開記錄。片段處理時間不包含引擎 HTTP 與 tokenizer 準備，不能與其他組 HTTP p50／p95 當作可比端到端延遲。完整成本另需包含初始化、詞庫載入、索引建置、資料規模及索引大小。單機小資料的分位數不是大規模或跨機效能保證。

## 可重現性與第三方資料

搜尋文本直接包含在 dataset；COCT 由固定官方 URL、原始 SHA256 與確定性程序產生。Manifest 對所有執行輸入及 runner source 記錄前後 SHA256，檢查測量期間的一致性。結果與資料版本配對，不以重新抓來源網站代替固定快照。

第三方文本、引擎、OpenCC 與 COCT 各自適用來源條款。倉庫 MIT LICENSE 覆蓋自建程式、文件與自寫合成資料，不替第三方來源重新授權。來源與完整性資訊見 [datasets](datasets.md) 與 [第三方聲明](../THIRD_PARTY_NOTICES.md)。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [runFlag, runPath, outFlag, outPath] = process.argv.slice(2);
if (runFlag !== '--run' || outFlag !== '--out' || !runPath || !outPath || process.argv.length !== 6) {
  throw new Error('Usage: node tools/export-ranking-threshold-report.mjs --run DIR --out NEW_DIR');
}
const input = path.resolve(runPath);
const output = path.resolve(outPath);
const json = async (folder, file) => JSON.parse(await readFile(path.join(folder, file), 'utf8'));
const manifest = await json(input, 'manifest.json');
if (manifest.status !== 'succeeded' || !manifest.inputsUnchanged || !manifest.instrumentationPreservesBaseline) {
  throw new Error('Only successful, verified experiment runs can be exported');
}
if (manifest.appCommit !== 'ab6aed805f96d9933849ca3e25399d860934e643' || manifest.appSourceStatus) {
  throw new Error('This first-round report narrative requires the clean ab6aed8 search implementation; review the narrative for a new product version');
}
const summary = await json(input, 'summary.json');
const evidence = [];
const reviewQueue = [];
const distribution = [];
for (const source of manifest.datasets) {
  const bytes = await readFile(path.join(root, source.file));
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Dataset changed: ${source.id}`);
  const dataset = JSON.parse(bytes);
  const filename = `${path.basename(path.dirname(source.file))}.json`;
  const results = await json(input, filename);
  evidence.push({ filename, results });
  const baseline = results.runs.find((run) => run.mode === 'app-162' && run.threshold === null);
  const raw = results.runs.find((run) => run.mode === 'engine' && run.threshold === null);
  for (const query of dataset.queries) {
    const expected = new Set(query.expectedIds);
    const forbidden = new Set(query.forbiddenIds);
    for (const hit of raw.queries.find((row) => row.id === query.id).hits) {
      distribution.push({ dataset: dataset.id, queryId: query.id, documentId: hit.id,
        score: hit.mainQueryScore, label: expected.has(hit.id) ? 'expected'
          : forbidden.has(hit.id) || query.expectZero ? 'forbidden' : 'unjudged' });
    }
    if (dataset.id !== 'real-34-v1') continue;
    for (const hit of baseline.queries.find((row) => row.id === query.id).hits) {
      if (expected.has(hit.id) || forbidden.has(hit.id) || query.expectZero) continue;
      const document = dataset.documents.find((document) => document.id === hit.id);
      reviewQueue.push({ queryId: query.id, query: query.query, documentId: hit.id,
        title: document.title, mainQueryScore: hit.mainQueryScore, origin: hit.origin,
        retainedAtThresholds: results.runs.filter((run) => run.mode === 'app-162'
          && run.queries.find((row) => row.id === query.id).ids.includes(hit.id)).map((run) => run.threshold),
        relevance: null, notes: '' });
    }
  }
}
await mkdir(output);
const save = (file, value) => writeFile(path.join(output, file), `${JSON.stringify(value, null, 2)}\n`);
await save('manifest.json', manifest);
await save('summary.json', summary);
await save('score-distribution.json', distribution);
await save('review-queue.json', reviewQueue);
for (const { filename, results } of evidence) {
  await writeFile(path.join(output, filename), `${JSON.stringify(results)}\n`);
}
const cell = (threshold) => threshold === null ? '不設門檻' : threshold;
const table = (mode) => manifest.thresholds.map((threshold) => {
  const rows = summary.filter((row) => row.mode === mode && row.threshold === threshold);
  const ranking = rows.flatMap((row) => row.ranking);
  const evaluable = ranking.filter((row) => row.evaluable);
  const rankingCell = evaluable.length > 0 ? `${evaluable.filter((row) => row.pass).length}/${evaluable.length}` : '不可評估（缺候選）';
  return `| ${cell(threshold)} | ${rows.map((row) => `${row.expectedFound}/${row.expectedTotal}`).join(' | ')} | ${rows.reduce((sum, row) => sum + row.forbiddenReturned, 0)} | ${rankingCell} |`;
}).join('\n');
const markdown = `# Ranking 分數門檻實驗（2026-10-28）

本輪結果不支持在 XR Collector 加入全域最低分數門檻。低分包含有效的錯字／前綴查詢；高分也可能是中文分散字誤收。目前片段層已排除這些明確誤收，直接提高引擎門檻則會造成漏查及既有排名退步。

## 方法與範圍

- 直接載入 XR Collector commit \`${manifest.appCommit.slice(0, 7)}\` 的搜尋 backend、查詢規劃、片段索引及詞庫，不使用 B4 參考實作代替產品流程。相關來源無未提交修改，執行前後驗證輸入 hash。
- 使用產品的 Meilisearch ${manifest.datasets[0].version.pkgVersion} binary、COCT、正規化及關閉二次切分的設定。保留全部 ranking rules：\`${manifest.datasets[0].settings.rankingRules.join(' → ')}\`。
- 3 組固定資料，共 83 份文件、128 題查詢；比較 7 組門檻與 2 種模式，共 42 組資料集／模式／門檻組合。沒有改動文件、查詢或既有 gold，也沒有使用 gold 決定候選。
- engine 模式只使用引擎結果；app-162 模式沿用產品的中文片段補召回及中英混合查詢。這是隔離後端實驗，沒有操作使用者知識庫，也不代表完整 App／UI 驗收或大型語料效能。
- 門檻套用於候選搜尋，包括主查詢與 Latin 補充搜尋；取回指定 ID 的詳細資料不套門檻，不將其空查詢分數當作相關性分數。片段層沒有另外指定分數，也沒有將未計分者當作 0。
- 每組資料的兩種模式先各跑不取分數的產品基準，再確認加入分數觀測後的完整回應相同，共 256 次基準比對。所有候選頁均帶同一門檻，未改查詢匹配策略。
- 資料集 queries 內帶 exploratory metadata 的列，依既有評測契約仍納入既有 gold；獨立 exploratoryQueries 不納入本輪數字。數字是查詢×文件配對，不是去重文件數。
- 排名案例僅在兩份候選都存在時評估；缺少候選不算排名通過。

## 最接近產品行為的結果（app-162）

| 門檻 | 合成集應命中 | 真實集應命中 | 保留集應命中 | 明確誤收總數 | 既有排名案例通過 |
| --- | --- | --- | --- | --- | --- |
${table('app-162')}

真實集本來就有 1 組未命中的 gold：M30「台績電」，屬中文錯字查詢。基準為 49/50，不能把這個原有差異歸因為門檻。現有產品的中文連續片段限制與此題的 fuzzy 期待不同，本輪保留此差異，不改標註來提高成績。

所有 app-162 組合的明確誤收及 expectZero 違反均為 0，僅限現有標註；真實集另有 ${reviewQueue.length} 組未判定結果，不能因此宣稱產品沒有雜訊。待補標項目在 [review-queue.json](review-queue.json)，相關性保持 null。

## 具體觀察

1. 真實集查詢「Nvdia」的一份已知正例分數約 0.048，門檻 0.2 就刪除；「Windwos」的已知正例約 0.487。正確拼字「Perseverance」的正例也只有約 0.751，門檻 0.8 會漏掉。低分不能直接判定為無關。
2. engine 模式的「半導」誤收約 0.824、「室氣」誤收約 0.883，仍是高分。app-162 的連續片段驗證已排除這些案例，不需要靠分數門檻補救。
3. 純中文的候選可能先被引擎門檻移除，隨後又被片段層補回。因此合成集提高到 0.95，membership 仍是 38/38，不能解讀為「高門檻完全無副作用」。
4. 門檻從 0.8 起，既有「導體」完整詞優先於「半導體」片段的案例反轉。兩份文件都還在，但落入片段補回區後，順序變成內部文件順序；只檢查召回率會漏掉這個退步。
5. 保留集在 0.6 開始漏掉 Latin typo 正例，0.8 又漏掉 prefix 正例。門檻的影響與查詢種類有關。

## 引擎單獨結果（對照）

| 門檻 | 合成集應命中 | 真實集應命中 | 保留集應命中 | 明確誤收總數 | 既有排名案例通過 |
| --- | --- | --- | --- | --- | --- |
${table('engine')}

本輪只調整官方支援的 rankingScoreThreshold 並讀取分數明細，沒有修改 ranking rules。規則是逐層排序，分數不是人工相關性標註或已校準的相關機率。功能背景見 [Meilisearch 官方門檻說明](https://www.meilisearch.com/blog/meilisearch-1-9)。

## 建議

先保留產品目前的召回條件與 ranking rules，不採用本輪任一全域分數門檻。接下來先人工標註真實集的未判定結果，將「主題高度相關／僅提及／無關」分開，再決定是否值得做第二輪排序或查詢類型實驗。若要對片段補召回也套用相關性條件，需要明確定義其評分與合併順序，不能只加一個引擎參數。

資料量小，既有集合也已公開，這輪是回歸與探索證據，無法選出適用所有知識庫的最佳門檻；沒有完整分級標註，未宣稱完整 precision 或 nDCG 改善。

## 重跑與證據

先依 port-registry 分配隔離連接埠，輸出目錄須不存在。app-root 指向有相同版本來源、node_modules（tsx）及已備妥 binary／COCT 的 XR Collector checkout。

\`\`\`sh
node tools/ranking-threshold-experiment.mjs --app-root ../xr-collector \\
  --port <reserved-port> --out results/ranking-thresholds-new
node tools/export-ranking-threshold-report.mjs --run results/ranking-thresholds-new \\
  --out reports/ranking-thresholds-new
npm run verify
\`\`\`

- [執行身分、輸入 hash、索引設定與完成狀態](manifest.json)
- [各門檻摘要及逐題移除清單](summary.json)
- [引擎基準分數與既有標註分布](score-distribution.json)
- [合成集：逐題分數明細、來源與排名](zh-semantics-v1.json)
- [真實集：逐題分數明細、來源與排名](real-34.json)
- [保留集：逐題分數明細、來源與排名](zh-contiguous-holdout-v1.json)
- [真實集待補標清單](review-queue.json)
`;
await writeFile(path.join(output, 'README.md'), markdown);
console.log(`Exported ${evidence.length} datasets and ${reviewQueue.length} unjudged query/document pairs.`);

import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(!args.includes('--runs')||!args.includes('--out'))throw Error('Usage: node tools/export-report.mjs --runs DIR,DIR,... --out NEW_REPORT_DIRECTORY');
const dirs=option('--runs').split(','),out=path.resolve(option('--out'));
const rows=[];
for(const dir of dirs){
 const [manifest,result]=await Promise.all(['manifest.json','results.json'].map(async f=>JSON.parse(await readFile(path.join(dir,f),'utf8'))));
 if(manifest.status!=='succeeded'||result.status!=='succeeded')throw Error(`Refusing failed run: ${dir}`);
 const failures=new Set([...result.metrics.missingExpected,...result.metrics.negativeViolations].map(x=>x.queryId));
 for(const x of result.metrics.expectZeroViolations)failures.add(x.queryId);
 const judged=result.queries.filter(q=>q.evaluationSet==='judged');
 const hashes=Object.fromEntries(Object.entries(manifest.files).map(([key,v])=>[key,{sha256:v.sha256,beforeSha256:v.beforeSha256,afterSha256:v.afterSha256,unchanged:v.unchanged}]));
 rows.push({datasetId:result.datasetId,baseline:result.baseline,runAt:manifest.createdAt,quality:{judgedRecall:result.metrics.judgedRecall,negativeViolations:result.metrics.negativeViolations.length,expectZeroViolations:result.metrics.expectZeroViolations.length,fullyPassingQueries:judged.length-failures.size,judgedQueryCount:judged.length,ranking:result.metrics.ranking,unjudgedResultCount:result.metrics.unjudgedResultCount},metrics:result.metrics,identity:{files:hashes,runnerSource:manifest.runnerSource,baselineConfig:manifest.baselineConfig,engineVersion:manifest.engine.version,engineSettings:manifest.engine.settings,normalization:manifest.normalization,runtime:Object.fromEntries(Object.entries(manifest.runtime).filter(([k])=>k!=='port'))},queries:result.queries.map(q=>({id:q.id,query:q.query,evaluationSet:q.evaluationSet,allIds:q.allIds,topIds:q.topIds}))});
}
for(const id of new Set(rows.map(x=>x.datasetId))){const group=rows.filter(x=>x.datasetId===id);if(new Set(group.map(x=>x.identity.files.dataset.sha256)).size!==1)throw Error('Dataset hashes differ');}
await mkdir(out);
const summary={schemaVersion:1,generatedAt:new Date().toISOString(),purpose:'Standalone runner bootstrap verification; development data, not a holdout or scale-performance study',notes:['Unjudged results are not irrelevant.','B4 inherits non-Han engine results and keeps eligible primary order; fragment recall is an in-memory reference.','B4 reference processing timing excludes engine HTTP and tokenizer preparation; it is not an end-to-end comparison.','Real document bodies, snippets, source titles, credentials and local paths are excluded.'],runs:rows};
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
let md='# 獨立 runner 首輪重跑\n\n這是本 repo 入口重新執行的結果，與搬遷前歷史摘要分開。測資皆為已用過的開發／回歸集，不是 holdout。\n\n';
for(const id of new Set(rows.map(x=>x.datasetId))){
 md+=`## ${id}\n\n| 組別 | 已標註正例命中 | 明確負例誤收 | 完整通過查詢 |\n| --- | ---: | ---: | ---: |\n`;
 for(const r of rows.filter(x=>x.datasetId===id)){const q=r.quality;md+=`| ${r.baseline} | ${q.judgedRecall.found}/${q.judgedRecall.total} | ${q.negativeViolations} | ${q.fullyPassingQueries}/${q.judgedQueryCount} |\n`;}
 md+='\n';
}
md+='## 如何解讀\n\nCOCT降低已知散字誤命中，但詞內片段可能漏查；只停用二次切分不會補足它們。B4在這個合成集滿足既定語意，仍是記憶體參考，不等於正式產品已整合。完整詞／片段排序只驗證指定fixture，未證明通用排序最佳。\n\nreal-34的forbidden標註為0，並有5題expectZero；不能用負例誤收為0宣稱precision完美。其完整通過查詢也只依既定正例與零命中條件，不代表所有回傳文件都相關。B1–B4尚有既有台績電錯字漏查。\n\n時間、版本與hash詳見[機器可讀結果](summary.json)。本次目的為程序與品質重現，不做速度或規模效能勝負結論；B4的參考層時間與Meili HTTP時間分開，不能混成可比的端到端延遲。\n\n## 重跑與輸出\n\n使用根目錄README的B0–B4命令，取得各自results/manifest後，以 `node tools/export-report.mjs --runs DIR,DIR,... --out NEW_REPORT_DIRECTORY` 建立白名單公開報告。原始執行目錄留在ignored results/；來源snapshot與詞庫留在ignored .cache/。本摘要保留query、ID與排名，不包含第三方全文／標題／snippet、環境路徑或憑證。\n';
await writeFile(path.join(out,'README.md'),md);
console.log(JSON.stringify({out,runs:rows.length}));

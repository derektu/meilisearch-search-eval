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
 const hashes=Object.fromEntries(Object.entries(manifest.files).map(([key,v])=>[key,{sha256:v.sha256,beforeSha256:v.sha256,afterSha256:v.sha256After,unchanged:v.unchanged}]));
 rows.push({datasetId:result.datasetId,baseline:result.baseline,runAt:manifest.createdAt,quality:{judgedRecall:result.metrics.judgedRecall,negativeViolations:result.metrics.negativeViolations.length,expectZeroViolations:result.metrics.expectZeroViolations.length,fullyPassingQueries:judged.length-failures.size,judgedQueryCount:judged.length,ranking:result.metrics.ranking,unjudgedResultCount:result.metrics.unjudgedResultCount},metrics:result.metrics,identity:{files:hashes,runnerSource:manifest.runnerSource,baselineConfig:manifest.baselineConfig,engineVersion:manifest.engine.version,engineSettings:manifest.engine.settings,normalization:manifest.normalization,runtime:Object.fromEntries(Object.entries(manifest.runtime).filter(([k])=>k!=='port'))},queries:result.queries.map(q=>({id:q.id,query:q.query,evaluationSet:q.evaluationSet,allIds:q.allIds,topIds:q.topIds}))});
}
for(const id of new Set(rows.map(x=>x.datasetId))){const group=rows.filter(x=>x.datasetId===id);if(new Set(group.map(x=>x.identity.files.dataset.sha256)).size!==1)throw Error('Dataset hashes differ');}
const distributionControl=[...new Set(rows.map(r=>r.datasetId))].flatMap(id=>{
 const official=rows.find(r=>r.datasetId===id&&r.baseline==='B1'),control=rows.find(r=>r.datasetId===id&&r.baseline==='C1');
 if(!official||!control)return [];
 const byId=new Map(control.queries.map(q=>[q.id,q]));
 return [{datasetId:id,changedQueryIds:official.queries.filter(q=>JSON.stringify(q.allIds)!==JSON.stringify(byId.get(q.id)?.allIds)).map(q=>q.id),meaning:'B1 official release and C1 Chinese-only source build; IDs and order on this dataset only'}];
});
await mkdir(path.dirname(out),{recursive:true});await mkdir(out);
const summary={schemaVersion:1,generatedAt:new Date().toISOString(),purpose:'Chinese search reference evaluation on versioned development datasets',notes:['Unjudged results are not irrelevant.','B4 inherits non-Han engine results and keeps eligible primary order; fragment recall is an in-memory reference.','B4 reference processing timing excludes engine HTTP and tokenizer preparation; it is not an end-to-end comparison.','The report includes metrics, identities and ID/rank results. Input texts are versioned separately in datasets/. Credentials and local paths are excluded.'],distributionControl,runs:rows};
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
let md='# 中文搜尋方案評測\n\n本報告使用固定文件、查詢與相關性標註，評估正規化、詞庫、二次切分與連續片段查詢。兩組資料皆為開發／回歸集，不是獨立保留集。\n\n## 方案設定\n\n| 組別 | 設定 |\n| --- | --- |\n| B0 | 官方Meilisearch community release，無正規化 |\n| B1 | 相同官方release＋正規化 |\n| C1 | 同版本Chinese-only source build＋正規化 |\n| B2 | Chinese-only＋正規化＋外部COCT主庫 |\n| B3 | B2＋保留第一輪完整詞界 |\n| B4 | B3＋連續片段補召回與驗證參考 |\n\nB0／B1的binary SHA符合固定官方release。C1用來檢查官方release與自行建置差異；C1→B2才是同source／toolchain／features下的詞庫對照。B1→B2同時改變建置與詞庫，不單獨歸因為詞庫效果。各run的binary、字典、baseline設定、資料及runner source hash在機器可讀結果中記錄。\n\n';
for(const id of new Set(rows.map(x=>x.datasetId))){
 md+=`## ${id}\n\n| 組別 | 已標註正例命中 | 明確負例誤收 | 完整通過查詢 |\n| --- | ---: | ---: | ---: |\n`;
 for(const r of rows.filter(x=>x.datasetId===id)){const q=r.quality;md+=`| ${r.baseline} | ${q.judgedRecall.found}/${q.judgedRecall.total} | ${q.negativeViolations} | ${q.fullyPassingQueries}/${q.judgedQueryCount} |\n`;}
 md+='\n';
}
for(const control of distributionControl)md+=`${control.datasetId}：B1／C1有${control.changedQueryIds.length}題命中ID或排序不同。此控制結果只涵蓋本測資，不宣稱不同發行／建置在所有語言上等價。\n\n`;
md+='## 結果解讀\n\n正例召回與負例誤收分別呈現。正規化能補回等價字形查詢，也可能讓預設切分的分散字候選進入結果。COCT主庫提供完整繁體詞界，但詞內片段需要額外召回。保留第一輪詞界與片段補召回是兩個獨立控制變數。\n\nB4使用記憶體參考索引、連續字串驗證與合格primary結果優先；排序案例只驗證指定文件對，不代表通用排序最佳。無漢字查詢沿用引擎結果。中英混合錯字、跨詞界片段與大資料效能有各自的驗證需求。\n\nreal-34-v1有50組正例、0組明確負例及5題expectZero；負例誤收為0不代表precision完美。其完整通過查詢只依既定正例及零命中條件，未標註結果不當作不相關。\n\n## 重現與範圍\n\n文本與gold直接包含在repo。COCT和官方引擎透過固定連結取得並驗證hash。根目錄README提供建置與matrix命令；每次使用新輸出目錄，完整性檢查要求執行前後輸入一致。\n\n原始結果保留首次查詢與暖查詢時間；[機器可讀結果](summary.json)包含逐題ID／排名、metrics及實際執行身分。本報告不作速度或規模效能勝負結論。B4的記憶體處理時間未包含tokenizer準備與完整引擎HTTP流程，不能當作可比的端到端延遲。\n';
await writeFile(path.join(out,'README.md'),md);
console.log(JSON.stringify({out,runs:rows.length}));

import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const raw=process.argv.slice(2),options={};
if(raw.includes('--help')){console.log('Usage: npm run eval:matrix -- --dataset PATH --port FREE_PORT --out NEW_DIR [--passes 3]');process.exit(0);}
for(let i=0;i<raw.length;i+=2){const key=raw[i],value=raw[i+1];if(!['--dataset','--port','--out','--passes'].includes(key)||!value||key in options)throw Error('Use --help');options[key]=value;}
if(!options['--dataset']||!options['--port']||!options['--out'])throw Error('Use --help');
const out=path.resolve(options['--out']);await mkdir(path.dirname(out),{recursive:true});await mkdir(out);
const suffix=process.platform==='win32'?'.exe':'';
const binary=(name)=>path.join(root,'.cache/engines',name+suffix);
const dictionary=path.join(root,'.cache/lexicons/coct-1141208/coct-news.txt');
const tokenizer=path.join(root,'tools/tokenizer/target/release','search-eval-tokenizer'+suffix);
const runs=[];
function run(args){const child=spawnSync(process.execPath,args,{stdio:'inherit',cwd:root});if(child.error)throw child.error;if(child.status!==0)throw Error(`Evaluation command failed with status ${child.status}`);}
for(const baseline of ['B0','B1','C1','B2','B3','B4']){
 const dir=path.join(out,baseline),stock=baseline==='B0'||baseline==='B1';
 const args=[path.join(root,'src/cli.mjs'),'run','--dataset',path.resolve(options['--dataset']),'--baseline',baseline,'--binary',binary(stock?'meilisearch-official':baseline==='C1'?'meilisearch-chinese-only':'meilisearch-coct-external'),'--port',options['--port'],'--out',dir,'--passes',options['--passes']??'3'];
 if(!stock&&baseline!=='C1')args.push('--dictionary',dictionary);
 if(baseline==='B4')args.push('--tokenizer',tokenizer);
 run(args);runs.push(dir);
}
run([path.join(root,'src/cli.mjs'),'compare','--runs',runs.join(','),'--out',path.join(out,'comparison.json')]);

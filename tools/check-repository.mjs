import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const ignored=new Set(['.git','node_modules','.cache','results','target']);
async function list(dir='.') {const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(ignored.has(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await list(p));else out.push(p);}return out;}
const files=await list();const problems=[];
for(const file of files){
 if(file.endsWith('.mjs')){try{execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}catch(e){problems.push(`Syntax error: ${file}: ${e.stderr}`);}}
 if(!/\.(mjs|md|json|yml|yaml|toml|rs|txt|patch)$/u.test(file))continue;
 const text=await readFile(file,'utf8');
 if(/\/Users\/[^/]+\//u.test(text)||/[A-Z]:\\Users\\/u.test(text))problems.push(`Machine-specific home path: ${file}`);
 if(file.endsWith('.md')){
  if((text.match(/^```/gmu)??[]).length%2)problems.push(`Unclosed Markdown fence: ${file}`);
  for(const m of text.matchAll(/\]\(([^)]+)\)/gu)){
   const target=m[1].replace(/^<|>$/gu,'');
   if(/^[a-z][a-z\d+.-]*:/iu.test(target)||target.startsWith('#'))continue;
   const dest=path.resolve(path.dirname(file),decodeURIComponent(target.split('#')[0]));
   try{await readFile(dest);}catch{problems.push(`Broken local link: ${file} -> ${target}`);}
  }
 }
}
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log(`Checked ${files.length} files: JavaScript syntax, Markdown links/fences and machine-specific paths.`);

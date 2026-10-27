import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {validateDataset} from './validate.mjs';
const folder=process.argv[2]?pathToFileURL(path.resolve(process.argv[2])+path.sep):new URL('../../datasets/real-34/',import.meta.url);
const bytes=await readFile(new URL('dataset.json',folder));
const dataset=JSON.parse(bytes),manifest=JSON.parse(await readFile(new URL('source-manifest.json',folder),'utf8'));
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const metrics=validateDataset(dataset);
check(hash(bytes)===manifest.datasetFileSha256,'Corpus file checksum mismatch');
check(dataset.id===manifest.id,'Corpus ID mismatch');
check(hash(dataset.documents)===manifest.documentsJsonSha256,'Corpus document checksum mismatch');
check(hash(dataset.queries)===manifest.queriesJsonSha256,'Corpus query checksum mismatch');
check(metrics.documents===manifest.documentCount&&metrics.queries===manifest.queryCount,'Corpus counts mismatch');
check(metrics.expectedPairs===manifest.expectedPairs&&metrics.forbiddenPairs===manifest.forbiddenPairs,'Corpus gold counts mismatch');
check(manifest.documents.length===dataset.documents.length,'Source manifest coverage mismatch');
for(let i=0;i<dataset.documents.length;i++){
 const d=dataset.documents[i],r=manifest.documents[i];
 check(d.id===r.id&&hash(d)===r.documentJsonSha256,`Document checksum mismatch: ${d.id}`);
 check(hash(d.title)===r.titleUtf8Sha256,`Title checksum mismatch: ${d.id}`);
 check(hash(d.bodyMarkdown)===r.bodyMarkdownUtf8Sha256,`Body checksum mismatch: ${d.id}`);
 check(hash(d.publisher)===r.publisherJsonSha256,`Publisher checksum mismatch: ${d.id}`);
}
const queries=JSON.parse(await readFile(new URL('queries.json',folder),'utf8'));
check(hash(Array.isArray(queries)?queries:queries.queries)===manifest.queriesJsonSha256,'Standalone queries differ from dataset');
console.log(JSON.stringify({...metrics,textHashesVerified:true,file:fileURLToPath(new URL('dataset.json',folder))}));

// Read-only original XLS verification. Local private output; never uploaded.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out='outputs/repair';await mkdir(out,{recursive:true});
await build({entryPoints:['lib/hr/fingerprint.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:out+'/parser.mjs'});
const {parseFingerprint}=await import('../'+out+'/parser.mjs');
const specs=[['daily','2026-10-02',process.argv[2]],['monthly','2026-09',process.argv[3]]];
const results=[];
for(const [kind,period,file] of specs){
 if(!file)throw Error('Supply original daily and monthly XLS paths');
 const bytes=await readFile(resolve(file));const start=performance.now();
 const parsed=parseFingerprint(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),kind,period);
 const milliseconds=performance.now()-start;
 await writeFile(out+'/'+kind+'-original.private.json',JSON.stringify(parsed));
 results.push({kind,period,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,rows:parsed.rows.length,source_counts:parsed.source_counts,distinct_minutes:parsed.rows.reduce((n,r)=>n+r.punch_minutes.length,0),milliseconds});
}
await writeFile(out+'/original-parser-summary.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));

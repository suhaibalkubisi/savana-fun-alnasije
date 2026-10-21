import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const output=path.resolve(process.argv[2]||'work/release-evidence');await fs.mkdir(output,{recursive:true});
const checks=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['scripts/lint-verified.mjs']],['regression',['--test','--test-concurrency=2',...((await fs.readdir('tests')).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f))]]];
const results=[];
for(const [name,args]of checks){
 const log=path.join(output,name+'.log'),stream=createWriteStream(log),start=Date.now();
 const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});await new Promise(resolve=>stream.end(resolve));
 const data=await fs.readFile(log),result={name,code,elapsed_ms:Date.now()-start,log:path.basename(log),sha256:createHash('sha256').update(data).digest('hex')};results.push(result);console.log(JSON.stringify(result));
 await fs.writeFile(path.join(output,'checks.json'),JSON.stringify({node:process.version,platform:process.platform,generated_at:new Date().toISOString(),results},null,2));
 if(code!==0){console.log(data.toString('utf8').split('\n').filter(l=>l.startsWith('test at ')||l.startsWith('  error:')||l.startsWith('  Error:')||l.includes('fail ')).slice(-30).join('\n'));process.exitCode=code||1;break;}
}

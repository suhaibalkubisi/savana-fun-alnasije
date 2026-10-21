import fs from 'node:fs';
import {spawn} from 'node:child_process';
const report=JSON.parse(fs.readFileSync(new URL('./verification/verification.json',import.meta.url),'utf8'));
if(!Array.isArray(report.tests)||report.tests.length!==33||report.tests.some(p=>!/^tests\/[a-z0-9-]+\.test\.mjs$/.test(p)))throw Error('Unexpected selected test list');
const child=spawn(process.execPath,['--test','--test-concurrency=2',...report.tests],{stdio:'inherit',windowsHide:true});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('close',code=>{process.exitCode=code??1;});

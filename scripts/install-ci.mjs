import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const manifest=JSON.parse(fs.readFileSync('package.json','utf8')),lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const packages={...manifest.dependencies,...manifest.devDependencies};let complete=true;
for(const name of Object.keys(packages)){
 const expected=lock.packages['node_modules/'+name]?.version;
 try{const actual=JSON.parse(fs.readFileSync('node_modules/'+name+'/package.json','utf8')).version;if(!expected||actual!==expected)complete=false;}catch{complete=false;}
}
if(complete){console.log('Verified installed dependency versions against the committed lockfile; existing cache reused.');process.exit(0);}
// Never run npm cleanup through reused package junctions.
if(fs.existsSync('node_modules')&&fs.readdirSync('node_modules').some(name=>fs.lstatSync(path.join('node_modules',name)).isSymbolicLink()))throw Error('Installed dependency inputs differ. Use a clean checkout for npm ci; reused package links are preserved.');
const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(!fs.existsSync(npm))throw Error('Run npm run install:ci with the supported Node/npm runtime.');
const child=spawn(process.execPath,[npm,'ci','--cache',path.resolve('.sites-runtime/npm-cache'),'--no-audit','--no-fund'],{stdio:'inherit',windowsHide:true});
const timer=setTimeout(()=>child.kill('SIGTERM'),600000);child.once('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});child.once('close',code=>{clearTimeout(timer);process.exitCode=code??1;});

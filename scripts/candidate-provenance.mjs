import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const baseline='5ea4c9ecb258b5f7ecb7fa5d7ec16de8bb6a9f47',output=path.resolve(process.argv[2]||'work/release-evidence');await fs.mkdir(output,{recursive:true});
const digest=b=>createHash('sha256').update(b).digest('hex');
const files=['public/brand/fanu-official-20260908.jpeg','public/brand/savana-official-20260908.png','public/fonts/Cairo.ttf','public/fonts/Cairo-750.ttf'];
const assets=[];for(const file of files){const original=execFileSync('git',['-c','safe.directory='+process.cwd(),'show',baseline+':'+file],{maxBuffer:16*1024*1024}),current=await fs.readFile(file);assets.push({file,sha256:digest(current),baseline_sha256:digest(original),byte_for_byte:current.equals(original)});}
const lum=color=>{const c=color.replace('#','').match(/../g).map(n=>parseInt(n,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
const pairs=[['body','#14243b','#ffffff'],['secondary on surface','#526176','#ffffff'],['secondary on page','#526176','#f5f7fb'],['primary button','#ffffff','#2456d8'],['sidebar','#ffffff','#12233d'],['present','#17713b','#e8f7ee'],['absent','#a72131','#fff0f1'],['leave','#8b5a11','#fff4dc'],['unresolved','#46556b','#edf0f5'],['information','#244fb2','#edf3ff']].map(([usage,foreground,background])=>{const a=lum(foreground),b=lum(background),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);return {usage,foreground,background,ratio:Number(ratio.toFixed(2)),normal_text_AA:ratio>=4.5};});
await fs.writeFile(path.join(output,'brand-and-contrast.json'),JSON.stringify({baseline,assets,contrast:pairs,scope:'Specified rendered color tokens; not a complete accessibility certification'},null,2));
if(assets.some(a=>!a.byte_for_byte)||pairs.some(p=>!p.normal_text_AA))throw Error('Brand/contrast verification failed');console.log('Original logos/fonts byte-for-byte and ten normal-text AA contrast pairs verified');

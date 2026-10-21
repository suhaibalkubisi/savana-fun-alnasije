// Native services only: this reverse proxy never authenticates user JWTs or emulates a database.
// Auth and SQL requests are handled by official GoTrue/PostgREST over native PostgreSQL.
import {createServer} from 'node:https';import http from 'node:http';import {spawn} from 'node:child_process';import {createWriteStream} from 'node:fs';import fs from 'node:fs/promises';import path from 'node:path';
if(process.argv[2]!=='--local-only')throw Error('Explicit --local-only required');
const root=process.cwd(),base=path.join(root,'work/native-acceptance'),out=path.join(root,'outputs/integration-2026-10-10');const c=JSON.parse(await fs.readFile(base+'/config.private.json','utf8'));
if(c.host!=='127.0.0.1'||c.pg_port!==56329||c.database!=='fanu_acceptance')throw Error('Local-only configuration required');
const tls={key:await fs.readFile(base+'/localhost-key.private.pem'),cert:await fs.readFile(base+'/localhost-cert.pem')};
function forward(req,res,port,url,headers){const r=http.request({hostname:'127.0.0.1',port,path:url,method:req.method,headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});r.on('error',()=>{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Native local upstream unavailable"}')});req.pipe(r);}
const api=createServer(tls,(req,res)=>{const key=req.headers.apikey;if(key!==c.publishable&&key!==c.secret_key){res.writeHead(401);res.end('{}');return;}const headers={...req.headers};delete headers.apikey;
 if(req.url.startsWith('/auth/v1/')){if(req.url.startsWith('/auth/v1/admin/')){if(key!==c.secret_key){res.writeHead(403);res.end('{}');return;}headers.authorization='Bearer '+c.service_jwt;}forward(req,res,c.auth_port,req.url.slice('/auth/v1'.length),headers);}
 else if(req.url.startsWith('/rest/v1/')){if(key===c.secret_key&&!headers.authorization)headers.authorization='Bearer '+c.service_jwt;forward(req,res,c.rest_port,req.url.slice('/rest/v1'.length),headers);}else{res.writeHead(404);res.end('{}');}
});
await new Promise(r=>api.listen(c.gateway_port,'127.0.0.1',r));
const log=createWriteStream(out+'/next-native.log');const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(c.app_https_port),'--experimental-https','--experimental-https-key',base+'/localhost-key.private.pem','--experimental-https-cert',base+'/localhost-cert.pem','--experimental-https-ca',base+'/localhost-cert.pem'],{cwd:base+'/app',windowsHide:true,env:{...process.env,HR_NEXT_BUILD:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_EXTRA_CA_CERTS:base+'/localhost-cert.pem',NEXT_PUBLIC_SUPABASE_URL:'https://localhost:'+c.gateway_port,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:c.publishable,SUPABASE_SECRET_KEY:c.secret_key}});child.stdout.pipe(log);child.stderr.pipe(log);
console.log('Actual Next handlers/cookies on https://localhost:'+c.app_https_port+'; native GoTrue/PostgREST; loopback only. Local gateway translates opaque admin key to service JWT.');
await new Promise(resolve=>{child.once('exit',resolve);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{child.kill();resolve()})});api.close();log.end();

import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','56494'],{windowsHide:true,stdio:'inherit',env:{...process.env,HR_NEXT_BUILD:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_EXTRA_CA_CERTS:path.resolve('work/candidate-cert/localhost-cert.pem'),NEXT_PUBLIC_SUPABASE_URL:'https://localhost:56490',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_candidate_fixture',SUPABASE_SECRET_KEY:'sb_secret_candidate_fixture_signing_key_2026'}});
fs.mkdirSync(path.resolve('..','evidence'),{recursive:true});fs.writeFileSync(path.resolve('..','evidence/candidate-app.pid'),String(child.pid));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill());child.once('close',code=>process.exitCode=code??1);

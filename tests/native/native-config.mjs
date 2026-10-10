import {readFile} from 'node:fs/promises';
export async function nativeConfig(){const c=JSON.parse(await readFile('work/native-acceptance/config.private.json','utf8'));if(c.host!=='127.0.0.1'||c.pg_port!==56329||c.database!=='fanu_acceptance'||c.gateway_port!==54410||c.app_https_port!==54413)throw Error('Only the workspace-owned native fixture is authorized');return c;}

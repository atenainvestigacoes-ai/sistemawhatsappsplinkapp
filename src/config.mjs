import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {resolveRuntime} from './runtime.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const data=path.resolve(process.env.SPLINK_DATA_DIR||path.join(root,'data')); mkdirSync(data,{recursive:true,mode:0o700});
export const runtime=resolveRuntime(root);
const tokenFile=path.join(data,'access-token');
if(!existsSync(tokenFile)) writeFileSync(tokenFile,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
export const token=readFileSync(tokenFile,'utf8').trim();
if(!/^[a-f0-9]{64}$/.test(token))throw Error('Código local inválido. Restaure data/access-token pelo backup.');
export const port=Number(process.env.SPLINK_PORT||3210);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('SPLINK_PORT precisa estar entre 1024 e 65535.');
export function knowledge() {
  const file=path.join(data,'empresa.md');
  const text=existsSync(file)?readFileSync(file,'utf8').slice(0,24000):'';
  const policyFile=path.join(data,'policy.json');
  const policy=existsSync(policyFile)?JSON.parse(readFileSync(policyFile,'utf8')):{};
  return {text,ready:text.trim().length>=100&&!text.includes('[PREENCHER]'),handoffReply:typeof policy.handoffReply==='string'?policy.handoffReply:'Só um instante, por favor. Alguém do nosso time vai responder em breve.',staffNumbers:Array.isArray(policy.staffNumbers)?policy.staffNumbers:[]};
}

import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(Number(process.versions.node.split('.')[0])!==24)throw Error('Use Node.js 24 LTS.');
const env=path.join(root,'.env');if(!existsSync(env))copyFileSync(path.join(root,'.env.example'),env);
process.loadEnvFile(env);
const {data}=await import('../src/config.mjs');mkdirSync(data,{recursive:true});
for(const [source,target] of [['empresa.example.md','empresa.md'],['policy.example.json','policy.json']]){
 const dest=path.join(data,target);if(!existsSync(dest))copyFileSync(path.join(root,'knowledge',source),dest);
}
console.log('Configuração inicial criada sem sobrescrever dados existentes.');
console.log('Edite .env e a base da empresa pelo painel. O sistema começa pausado.');
console.log('Código de acesso local:',path.join(data,'access-token'));
console.log('Confira README.md para instalar Python opcional e autenticar o Codex.');

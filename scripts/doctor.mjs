import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {runtime,data,port,knowledge} from '../src/config.mjs';
let failed=false;
function check(label,ok){console.log(`${ok?'OK':'PENDENTE'}: ${label}`);if(!ok)failed=true;}
check('Node.js 24 LTS',process.versions.node.split('.')[0]==='24');
check('Codex CLI instalado',spawnSync(runtime.codex,[...runtime.codexArgs,'--version'],{windowsHide:true,timeout:15000,stdio:'ignore'}).status===0);
const help=spawnSync(runtime.codex,[...runtime.codexArgs,'exec','--help'],{windowsHide:true,timeout:15000,encoding:'utf8'});
check('Codex aceita as opções de isolamento usadas pelo agente',help.status===0&&['--ignore-user-config','--ignore-rules','--output-schema'].every(s=>help.stdout.includes(s)));
check('Login do Codex disponível',spawnSync(runtime.codex,[...runtime.codexArgs,'login','status'],{windowsHide:true,timeout:15000,stdio:'ignore'}).status===0);
check('Python e bibliotecas de mídia (opcionais para texto)',spawnSync(runtime.python,['-c','import pypdf,openpyxl,av,faster_whisper'],{windowsHide:true,timeout:30000,stdio:'ignore'}).status===0);
check('Política local criada',existsSync(path.join(data,'policy.json')));
check('Base da empresa preenchida',knowledge().ready);
console.log(`Painel configurado: http://127.0.0.1:${port}. Este diagnóstico não inicia o servidor nem envia mensagens.`);
process.exitCode=failed?1:0;

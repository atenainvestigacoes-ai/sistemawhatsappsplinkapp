import {existsSync} from 'node:fs';
import path from 'node:path';
export function resolveRuntime(root,env=process.env){
 const win=process.platform==='win32';
 const python=env.SPLINK_PYTHON||path.join(root,'.venv',win?'Scripts/python.exe':'bin/python');
 let codex=env.SPLINK_CODEX||'codex',codexArgs=[];
 if(win&&!env.SPLINK_CODEX){for(const dir of (env.PATH||'').split(path.delimiter)){
  if(existsSync(path.join(dir,'codex.exe'))){codex=path.join(dir,'codex.exe');break;}
  const js=path.join(dir,'node_modules/@openai/codex/bin/codex.js');
  if(existsSync(js)){codex=process.execPath;codexArgs=[js];break;}
 }}
 if(codex.endsWith('.js')){codexArgs=[path.resolve(codex)];codex=process.execPath;}
 return{node:process.execPath,python:existsSync(python)?python:(env.SPLINK_PYTHON||(win?'python':'python3')),codex,codexArgs};
}

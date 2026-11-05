import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {runtime,data} from '../src/config.mjs';
const model=process.env.SPLINK_WHISPER_MODEL||'base';
if(!['tiny','base','small'].includes(model))throw Error('Modelo permitido: tiny, base ou small');
const result=spawnSync(runtime.python,['-c','import sys; from faster_whisper import WhisperModel; WhisperModel(sys.argv[1],device="cpu",compute_type="float32",download_root=sys.argv[2])',model,path.join(data,'models')],{windowsHide:true,stdio:'inherit'});
if(result.error)console.error('Instale o Python e as dependências: veja README.md.');
process.exitCode=result.status??1;

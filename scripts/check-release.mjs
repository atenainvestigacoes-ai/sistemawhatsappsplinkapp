import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const roots=new Set(['README.md','LICENSE','SECURITY.md','.gitignore','.env.example','package.json','package-lock.json','requirements.txt','Iniciar.cmd','Iniciar.ps1']);
const folders=new Set(['src','public','test','scripts','docs','examples','.github']);
const ignored=new Set(['node_modules','data','.venv','runtime','runtime.json','.env','.git','release','dist']);
const allowed=[],errors=[];
async function visit(folder=''){
 for(const e of await readdir(path.join(root,folder),{withFileTypes:true})){
  const rel=path.posix.join(folder,e.name),top=rel.split('/')[0];
  if(ignored.has(top)||e.name==='__pycache__'||e.name.endsWith('.pyc'))continue;
  if(e.isSymbolicLink()){errors.push('Link simbólico não permitido: '+rel);continue;}
  if(e.isDirectory()){if(folders.has(top)||top==='knowledge')await visit(rel);else errors.push('Diretório fora da lista permitida: '+rel);continue;}
  if(!(roots.has(rel)||folders.has(top)||['knowledge/empresa.example.md','knowledge/policy.example.json'].includes(rel))){errors.push('Arquivo fora da lista permitida: '+rel);continue;}
  if(/\.(sqlite|db|log|ogg|mp3|mp4|png|jpe?g|zip)$/i.test(rel)){errors.push('Dados/binário não permitido: '+rel);continue;}
  const body=await readFile(path.join(root,rel),'utf8');
  if(/-----BEGIN [A-Z ]*PRIVATE KEY|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|C:[\\/]Users[\\/]/.test(body))errors.push('Possível segredo ou caminho pessoal: '+rel);
  allowed.push(rel);
 }
}
await visit();allowed.sort();
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else if(process.argv.includes('--json'))console.log(JSON.stringify({files:allowed}));
else console.log(`Release conferida: ${allowed.length} arquivos permitidos. Dados, sessões, ambientes e credenciais não fazem parte do pacote.`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/public-source-manifest.json'),'utf8'));
const selected=new Map(manifest.omittedModules.map(item=>[item.path,item]));
const excluded=new Set(manifest.excludedPaths);
const output=path.join(root,'.public-export',new Date().toISOString().replace(/[:.]/g,'-'));
const files=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
// Include the new, reviewed export tooling and newly implemented modules before
// their first commit, but never indiscriminately include untracked user files.
for(const name of ['scripts/export-public-source.mjs','scripts/public-source-manifest.json',
  'docs/PUBLIC-SOURCE.md','docs/N8N-TERRAIN.md','src/game/googleTileSession.js','src/game/terrainView.js']) {
  if(fs.existsSync(path.join(root,name))) files.add(name);
}
fs.mkdirSync(output,{recursive:true});
let copied=0,omitted=0;
for(const name of files) {
  if(excluded.has(name)||name.startsWith('.env')&&name!=='.env.example'||
    name.startsWith('server/')||name.startsWith('.public-export/')||name.startsWith('dist/')||
    name.startsWith('node_modules/')||name.startsWith('.git/')||name.endsWith('.map')) continue;
  const source=path.resolve(root,name);
  if(!source.startsWith(root+path.sep)) throw Error('Invalid source path');
  if(!fs.existsSync(source)||!fs.lstatSync(source).isFile()) continue;
  const target=path.join(output,name);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(selected.has(name)) {
    fs.writeFileSync(target,'/* '+manifest.notice+'\n * '+selected.get(name).description+'\n * Oryginalny moduł znajduje się w prywatnej dystrybucji źródeł.\n */\n');
    omitted++;
  } else {
    if(/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|yml|yaml|html|txt|env|example|css|scss|svg|xml|cmd|bat|ps1|sh|py|toml|ini))$/i.test(name)) {
      const text=fs.readFileSync(source,'utf8');
      if(/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(text)) {
        throw Error('Credential-shaped JWT found; public export stopped: '+name);
      }
    }
    fs.copyFileSync(source,target);copied++;
  }
}
const note='# Pominięte moduły źródłowe\n\n'+manifest.notice+'\n\n'+
  manifest.omittedModules.map(item=>'- '+item.path+': '+item.description).join('\n')+
  '\n\nTen eksport nie zawiera pełnej implementacji gry, sekretów, historii Git ani gotowego builda. '+
  'Nie można go przebudować bez prywatnych modułów. Kod wykonywany w przeglądarce pozostaje możliwy do analizy.\n';
fs.writeFileSync(path.join(output,'OMITTED-MODULES.md'),note);
const readme=path.join(output,'README.md');
fs.writeFileSync(readme,'> Publiczny eksport z pominiętymi modułami. Zobacz [OMITTED-MODULES.md](OMITTED-MODULES.md). Pełne źródła i kompilacja są utrzymywane osobno.\n\n'+fs.readFileSync(readme,'utf8'));
const containsGitHistory=fs.existsSync(path.join(output,'.git'));
const containsBuiltGame=fs.existsSync(path.join(output,'dist'));
if(containsGitHistory||containsBuiltGame) throw Error('Public export contains a forbidden generated directory');
console.log(JSON.stringify({output,copied,omitted,containsGitHistory,containsBuiltGame}));

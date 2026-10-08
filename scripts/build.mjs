import {mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const walk=dir=>readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=['server.mjs','package.json','.env.example','README.md','RIGHTS.md',...walk('src'),...walk('public')];
for(const file of [...files.filter(f=>f.endsWith('.mjs')),...walk('test').filter(f=>f.endsWith('.mjs'))]){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}}
const manifest=[];for(const file of files){const target=path.join(root,'dist',file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(root,file),target);manifest.push({file:file.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(target)).digest('hex')});}
writeFileSync(path.join(root,'dist','manifest.json'),JSON.stringify(manifest,null,2));console.log(`Build verified: ${files.length} production files; JavaScript syntax checked; no runtime dependencies. Output: dist/`);

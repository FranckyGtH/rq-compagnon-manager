import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import AdmZip from 'adm-zip';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);mkdirSync('outputs',{recursive:true});mkdirSync('analysis',{recursive:true});mkdirSync('dist',{recursive:true});
const version=JSON.parse(readFileSync('package.json')).version;
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${version}`)throw new Error('Release tag must match package.json version.');
copyFileSync('docs/guide.md',`outputs/RQ_Compagnon_Manager_Guide_v${version}.md`);
copyFileSync('docs/installation.md',`outputs/Installation_RQ_Compagnon_Manager_v${version}.md`);
for(const file of ['build-player.mjs','build-gm.mjs','build-guide.mjs','build-package.mjs']){
  const result=spawnSync(process.execPath,[`foundry/${file}`],{stdio:'inherit'});
  if(result.status!==0)throw new Error(`Build failed: ${file}`);
}
writeFileSync('outputs/companion-manager/README.md',`# RQ compagnon Manager ${version}\n\nInstallation and usage: docs/guide.html and docs/installation-v${version}.md.\n\nSource: https://github.com/FranckyGtH/rq-compagnon-manager\nManifest: https://github.com/FranckyGtH/rq-compagnon-manager/releases/latest/download/module.json\n\nThese URLs become available after the repository and release are published. Existing private dossiers remain in the Foundry world. No character exports are included.\n`);
copyFileSync('outputs/companion-manager/module.json','dist/module.json');
const zip=new AdmZip();zip.addLocalFolder('outputs/companion-manager','companion-manager');
zip.writeZip(`dist/RQ_Compagnon_Manager_Module_v${version}.zip`);
console.log(`GitHub release assets generated for ${version}.`);

import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url)),out=resolve(base,'../outputs'),target=resolve(out,'companion-manager');
mkdirSync(resolve(target,'scripts'),{recursive:true});mkdirSync(resolve(target,'docs'),{recursive:true});
mkdirSync(resolve(target,'icons'),{recursive:true});
const manifest={id:'companion-manager',title:'RQ compagnon Manager',description:'DM and PC progression managers for RuneQuest Glorantha. XP, TP, DP, seasonal training, characteristics and private DM dossiers. Stable macro engine 0.17.3.',version:'0.17.3',authors:[{name:'Projet Glorantha'}],compatibility:{minimum:'14.367',verified:'14.367',maximum:'14.367'},relationships:{systems:[{id:'rqg',type:'system',compatibility:{minimum:'6.1.1',maximum:'6.1.1'}}]},esmodules:['scripts/main.mjs']};
manifest.version='0.17.3';
manifest.url='https://github.com/FranckyGtH/rq-compagnon-manager';
manifest.manifest=manifest.url+'/releases/latest/download/module.json';
manifest.download=manifest.url+'/releases/download/v'+manifest.version+'/RQ_Compagnon_Manager_Module_v'+manifest.version+'.zip';
writeFileSync(resolve(target,'module.json'),JSON.stringify(manifest,null,2)+'\n');
for(const role of ['dm','pc'])for(const ext of ['svg','png'])copyFileSync(resolve(base,`../assets/icons/compagnon-${role}.${ext}`),resolve(target,`icons/compagnon-${role}.${ext}`));
copyFileSync(resolve(out,'Installation_RQ_Compagnon_Manager_v0.17.3.md'),resolve(target,'docs/installation-v0.17.3.md'));
copyFileSync(resolve(base,'package-main.mjs'),resolve(target,'scripts/main.mjs'));
for(const role of ['DM','PC']) {
  const code=readFileSync(resolve(out,`RQ_Compagnon_Manager_${role}_v0.17.3.js`),'utf8');
  new(Object.getPrototypeOf(async function(){}).constructor)(code);
  writeFileSync(resolve(target,`scripts/${role.toLowerCase()}.mjs`),`// Bundled unchanged standalone engine 0.17.3.\nexport async function launch() {\n${code}\n}\n`);
  copyFileSync(resolve(out,`RQ_Compagnon_Manager_${role}_v0.17.3.js`),resolve(target,`docs/RQ_Compagnon_Manager_${role}_v0.17.3.js`));
}
for(const ext of ['md','html'])copyFileSync(resolve(out,`RQ_Compagnon_Manager_Guide_v0.17.3.${ext}`),resolve(target,`docs/guide.${ext}`));
writeFileSync(resolve(target,'README.md'),'# RQ compagnon Manager module 0.17.3\n\nApproved Glorantha icons. Stable application engine 0.17.3. See docs/installation-v0.17.3.md for The Forge import and automatic launcher icon updates.\n\nExtract this folder into Foundry User Data / Data / modules, restart Foundry, and activate RQ compagnon Manager in Manage Modules. Log in as GM to create both launcher macros. Read docs/guide.html for installation and use. Existing world dossiers are reused; no private character data are shipped in this package.\n\nThis local package has no hosted manifest/download URL. Updates are manual. The stable macro engine was tested in Foundry by the user; the module installation wrapper still needs an in-world installation test.\n');
console.log('Local module built: '+target);

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
let seq=0;
async function environment({gm=true,version='14.367',otherGM=false}={}) {
  const macros=[],messages=[],module={active:true};let ready;
  globalThis.game={version,system:{id:'rqg',version:'6.1.1'},user:{id:'gm2',active:true,isGM:gm},users:[],macros,modules:new Map([['companion-manager',module]])};
  game.users=[game.user,...(otherGM?[{id:'gm1',active:true,isGM:true}]:[])];
  globalThis.ui={notifications:{error:v=>messages.push(v),warn:v=>messages.push(v)}};
  globalThis.Hooks={once:(name,callback)=>{assert.equal(name,'ready');ready=callback;}};
  globalThis.Macro={create:async data=>{const doc={...structuredClone(data),updates:0,update:async patch=>{doc.updates++;doc.name=patch.name;doc.command=patch.command;doc.img=patch.img;doc.flags['companion-manager'].version=patch['flags.companion-manager.version'];doc.flags['companion-manager'].packageVersion=patch['flags.companion-manager.packageVersion'];}};macros.push(doc);return doc;}};
  const api=await import(pathToFileURL(resolve('outputs/companion-manager/scripts/main.mjs')).href+`?test=${seq++}`);
  return {api,module,macros,messages,ready};
}
test('package manifest references complete local assets and wraps the exact stable macro engine',()=>{
  const base=resolve('outputs/companion-manager'),manifest=JSON.parse(readFileSync(resolve(base,'module.json')));
  assert.equal(manifest.id,'companion-manager');assert.equal(manifest.version,'0.17.3');assert.equal(manifest.compatibility.maximum,'14.367');assert.equal(manifest.relationships.systems[0].id,'rqg');
  for(const file of [...manifest.esmodules,'docs/guide.html','docs/guide.md'])assert.ok(readFileSync(resolve(base,file)).length);
  for(const role of ['DM','PC'])assert.equal(readFileSync(resolve(base,`scripts/${role.toLowerCase()}.mjs`),'utf8'),'// Bundled unchanged standalone engine 0.17.3.\nexport async function launch() {\n'+readFileSync(resolve('outputs',`RQ_Compagnon_Manager_${role}_v0.17.3.js`),'utf8')+'\n}\n');
  assert.equal(manifest.download,'https://github.com/FranckyGtH/rq-compagnon-manager/releases/download/v0.17.3/RQ_Compagnon_Manager_Module_v0.17.3.zip');
  for(const role of ['dm','pc'])for(const ext of ['svg','png'])assert.ok(readFileSync(resolve(base,`icons/compagnon-${role}.${ext}`)).length);
});
test('module registers guarded launchers and creates only two role-specific macros without touching existing macros',async()=>{
  const env=await environment();const old={name:'My standalone macro',flags:{},command:'unchanged'};env.macros.push(old);await env.ready();await env.api.installLaunchers();
  assert.equal(env.macros.length,3);assert.equal(old.command,'unchanged');assert.equal(env.module.api.version,'0.17.3');assert.equal(env.module.api.engineVersion,'0.17.3');
  const dm=env.macros.find(m=>m.flags?.['companion-manager']?.launcher==='dm'),pc=env.macros.find(m=>m.flags?.['companion-manager']?.launcher==='pc');
  assert.equal(dm.ownership.default,0);assert.equal(pc.ownership.default,2);assert.equal(pc.ownership.gm2,3);assert.match(pc.command,/openPC/);assert.match(dm.command,/openDM/);
  assert.equal(dm.img,'modules/companion-manager/icons/compagnon-dm.svg');assert.equal(pc.img,'modules/companion-manager/icons/compagnon-pc.svg');assert.equal(dm.updates,0);assert.equal(pc.updates,0);
  game.user.isGM=false;await env.module.api.openDM();assert.match(env.messages.at(-1),/reserved for the GM/);
});
test('player initialization creates no world documents and unsupported or secondary GM sessions do not install launchers',async()=>{
  for(const options of [{gm:false},{version:'14.368'},{otherGM:true}]){const env=await environment(options);await env.ready();assert.equal(env.macros.length,0);assert.ok(env.module.api);}
});
test('upgrading a module launcher refreshes its command without changing user ownership',async()=>{
  const env=await environment();await env.ready();const pc=env.macros.find(m=>m.flags['companion-manager'].launcher==='pc');pc.flags['companion-manager'].version='old';pc.command='old';pc.ownership.default=1;await env.api.installLaunchers();assert.match(pc.command,/openPC/);assert.equal(pc.ownership.default,1);assert.equal(env.macros.length,2);
});

// Upgrade from the previous installed package, whose engine version is unchanged.
test('old package launchers acquire approved icons once and preserve macro identity and ownership',async()=>{
  const env=await environment();await env.ready();
  for(const macro of env.macros){delete macro.flags['companion-manager'].packageVersion;macro.img='icons/svg/book.svg';macro.id=macro.flags['companion-manager'].launcher;macro.ownership.default=1;}
  await env.api.installLaunchers();
  for(const macro of env.macros){assert.equal(macro.img,`modules/companion-manager/icons/compagnon-${macro.id}.svg`);assert.equal(macro.flags['companion-manager'].packageVersion,'0.17.3');assert.equal(macro.ownership.default,1);assert.equal(macro.updates,1);}
  await env.api.installLaunchers();assert.equal(env.macros.length,2);assert.ok(env.macros.every(macro=>macro.updates===1));
});

test('branding upgrade renames owned module launchers without duplicating standalone macros',async()=>{
  const env=await environment();await env.ready();const old={name:'Compagnon Manager DM',flags:{},img:'custom.svg'};env.macros.push(old);
  for(const macro of env.macros.filter(m=>m.flags['companion-manager'])){macro.name='Compagnon Manager '+macro.flags['companion-manager'].launcher.toUpperCase()+' (Module)';macro.flags['companion-manager'].packageVersion='0.17.2';}
  await env.api.installLaunchers();assert.equal(env.macros.length,3);assert.equal(old.name,'Compagnon Manager DM');assert.equal(old.img,'custom.svg');
  for(const macro of env.macros.filter(m=>m.flags['companion-manager']))assert.equal(macro.name,'RQ compagnon Manager '+macro.flags['companion-manager'].launcher.toUpperCase()+' (Module)');
});

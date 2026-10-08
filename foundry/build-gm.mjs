import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {englishSource} from './english-source.mjs';
const base=dirname(fileURLToPath(import.meta.url));
const source=name=>readFileSync(resolve(base,'koronil-progression/scripts',name),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const code=`// RQ compagnon Manager — DM — v0.17.3
// Paste into a Foundry Script macro. Request notes and native Actor JSON export.
return (async()=>{
${englishSource(source('core.mjs'))}
const esc=escapeHTML;
${englishSource(source('distribution.mjs'))}
${source('season-training.mjs')}
${source('manager-state.mjs')}
${source('downtime-rules.mjs')}
${source('player-rules.mjs')}
${source('readable-notes.mjs')}
${source('downtime-application.mjs')}
${source('player-application.mjs')}
${source('gm-application.mjs')}
${source('apply-progression.mjs')}
${source('characteristics.mjs')}
${source('dm-compendium.mjs')}
${source('downtime-dm.mjs')}
${source('dm-synchronization.mjs')}
${source('actor-reference.mjs')}
${source('reference-application.mjs')}
try {
  requireGM();checkEnvironment(game);
  const actors=listActors(game.actors,game.user,'gm');
  const styleId=MODULE_ID+'-dm-v0173-css';
  if(!document.getElementById(styleId)) {
    const style=document.createElement('style');style.id=styleId;
    style.textContent=${JSON.stringify(['progression.css','distribution.css','player.css'].map(name=>readFileSync(resolve(base,'koronil-progression/styles',name),'utf8')).join('\n'))};
    document.head.append(style);
  }
  const holder=globalThis.koronilProgressionDMV0173??={};
  if(!holder.app) {
    const controlled=globalThis.canvas?.tokens?.controlled??[];
    const preferred=controlled.length===1?controlled[0].actor:game.user.character;
    const actorId=actors.some(actor=>actor.id===preferred?.id)?preferred.id:actors[0]?.id??null;
    holder.app=new GMProgressionApplication({actorId});
  }
  await holder.app.render({force:true});holder.app.bringToFront();
}catch(error){ui.notifications.error(error.message);console.error('RQ compagnon Manager DM v0.17.3',error);}
})();
`;
new(Object.getPrototypeOf(async function(){}).constructor)(code);
mkdirSync(resolve(base,'../outputs'),{recursive:true});
writeFileSync(resolve(base,'../outputs/RQ_Compagnon_Manager_DM_v0.17.3.js'),code,'utf8');
console.log('DM macro v0.17.3 generated; syntax checked.');

import { saveCharacterReference } from './actor-reference.mjs';
import { recordDMExchange, verifyDMExchange } from './dm-synchronization.mjs';
import { downtimeTypes, downtimeStatuses, convertedTrainingDP } from './downtime-rules.mjs';
import { requireGM } from './gm-application.mjs';
import { dmDossiers, managerState } from './manager-state.mjs';
import { escapeHTML } from './core.mjs';
import { checkNativeNotesSideEffects } from './distribution.mjs';
import { readReadableDistribution, writeReadableDistribution } from './readable-notes.mjs';
import { readPlayerActor } from './player-rules.mjs';

export const dmPackId='world.companion-manager-dm';
const dmPages=['Identity','Character backups','Characteristic ticks','Progression history','Export history','Downtime — DM','Downtime — Active','Downtime — Completed','Downtime — Failed','Private notes','Migration archive'];
const privateOwnership={PLAYER:'NONE',TRUSTED:'NONE',ASSISTANT:'OWNER',GAMEMASTER:'OWNER'};
const copyDM=value=>JSON.parse(JSON.stringify(value));
const dossierBusy=new Set();
export function checkDMPack(pack,{write=false}={}) {
  requireGM();
  if(!pack||pack.collection!==dmPackId||pack.documentName!=='JournalEntry')throw new Error('The DM journal compendium is missing or has the wrong document type.');
  if(['PLAYER','TRUSTED'].some(role=>pack.ownership?.[role]!=='NONE'))throw new Error('DM compendium permissions are not private. Use Repair permissions in Summary.');
  if(write&&pack.locked)throw new Error('The DM compendium is locked. Unlock it in Summary.');
  return pack;
}
export async function initializeDMPack() {
  requireGM();
  let pack=game.packs?.get(dmPackId);
  if(!pack)pack=await foundry.documents.collections.CompendiumCollection.createCompendium({name:'companion-manager-dm',label:'RQ compagnon Manager — DM',type:'JournalEntry',ownership:privateOwnership});
  if(pack.documentName!=='JournalEntry')throw new Error('Existing compendium uses the wrong document type.');
  await pack.configure({ownership:privateOwnership,locked:false});
  return checkDMPack(pack,{write:true});
}
function dossierData(document,actor) {
  const data=document?.flags?.world?.companionManagerDM;
  if(data?.schema!==1||data.actorUuid!==actor.uuid||data.progression?.schema!==1||!Array.isArray(data.progression.history)||!Array.isArray(data.exports))throw new Error('Invalid DM dossier or mismatched character reference.');
  return copyDM(data);
}
export async function loadDMDossier(actor) {
  requireGM();
  const ref=actor.flags?.world?.companionManager?.dossier;
  if(!ref){dmDossiers.delete(actor.uuid);return null;}
  if(ref.pack!==dmPackId||typeof ref.id!=='string')throw new Error('Invalid DM dossier link.');
  const pack=checkDMPack(game.packs?.get(ref.pack));
  const document=await pack.getDocument(ref.id),data=dossierData(document,actor);
  dmDossiers.set(actor.uuid,{document,data});
  try{await refreshDMDossierPages(actor,document,data);}catch(error){ui.notifications.warn(`Private data loaded; generated dossier pages need repair: ${error.message}. Reload the dossier in Summary.`);}
  return document;
}
function automaticPages(actor,data) {
  const esc=escapeHTML;
  return {
    Identity:`<h2>${esc(actor.name)} — DM dossier</h2><p>Actor: ${esc(actor.uuid)}<br>Created: ${esc(data.createdAt)}<br>Updated: ${esc(data.updatedAt)}</p><h3>DM synchronization</h3><p>Published revision: ${esc(data.synchronization?.revision??'Not initialized')}<br>Published at: ${esc(data.synchronization?.at??'—')}<br>Published by: ${esc(data.synchronization?.dm??'—')}</p>`,
    'Character backups':`<h2>Complete character references — latest five</h2><p>DM only. Restore from Summary → Reference / resynchronization.</p>${(data.characterBackups??[]).map(entry=>`<h3>${esc(entry.at)} — ${esc(entry.reason)}</h3><p>Reference: ${esc(entry.id)}${entry.id===data.characterReference?' (current)':''}<br>Actor: ${esc(entry.actorUuid)}<br>DM: ${esc(entry.dm??'—')}<br>Items: ${entry.actor.items.length}</p><details><summary>Complete saved Actor JSON</summary><pre>${esc(JSON.stringify(entry.actor,null,2))}</pre></details>`).join('')||'<p>No complete reference saved yet.</p>'}`,
    'Characteristic ticks':`<h2>Accumulated ticks</h2><ul>${Object.entries(data.progression.statTicks??{}).map(([key,value])=>`<li>${esc(key)}: ${esc(value)}</li>`).join('')}</ul><h3>Counter history</h3><pre>${esc(JSON.stringify(data.progression.characteristicHistory??[],null,2))}</pre>`,
    'Progression history':`<h2>Applied distributions</h2>${data.progression.history.map(tx=>`<h3>${esc(tx.completedAt??tx.startedAt)}</h3><pre>${esc(tx.plan?.markdownSummary??'')}</pre>`).join('')}<h3>Pending transaction</h3><pre>${esc(JSON.stringify(data.progression.active,null,2))}</pre>`,
    'Downtime — Active':downtimeJournalPage(data,['open'],'Active activities'),
    'Downtime — Completed':downtimeJournalPage(data,['complete'],'Completed activities'),
    'Downtime — Failed':downtimeJournalPage(data,['failed','cancelled'],'Failed / cancelled activities'),
    'Export history':`<h2>Latest five backup requests</h2>${data.exports.map(entry=>`<p>${esc(entry.phase)}<br>${esc(entry.at)}<br>${esc(entry.filename)}<br>DM: ${esc(entry.dm)}</p>`).join('')}`,
    'Migration archive':`<h2>Previous application data</h2><p>Copied before removing private data from the character.</p><pre>${esc(JSON.stringify(data.migration,null,2))}</pre>`
  };
}
function downtimeJournalPage(data,statuses,title) {
  const esc=escapeHTML,activities=(data.downtime?.activities??[]).filter(a=>statuses.includes(a.status));
  return '<h2>'+esc(title)+'</h2><p>DM only. Generated by RQ compagnon Manager; edit activities in the DM application.</p>'+activities.map(a=>`<h3>${esc(a.title)}</h3><p>Type: ${esc(downtimeTypes[a.type]??a.type)}<br>Status: ${esc(downtimeStatuses[a.status]??a.status)}<br>DP invested: ${esc(a.invested)}${a.type==='training'?`<br>DP converted to TP: ${convertedTrainingDP(a)}<br>Invested DP not yet converted: ${a.invested-convertedTrainingDP(a)}`:''}<br>DP required: ${esc(a.required??'Not set')}<br>Required DP visible to PC: ${a.showRequired?'Yes':'No'}<br>Complete on next application: ${a.completeOnApply?'Yes':'No'}<br>Activity reference: ${esc(a.id)}<br>Revision: ${esc(a.revision)}</p><h4>Description</h4><pre>${esc(a.description)}</pre><h4>Published DM response</h4><pre>${esc(a.response)}</pre><h4>Secret DM notes</h4><pre>${esc(a.secret)}</pre><h4>Investment history / conversions</h4><pre>${esc(JSON.stringify(a.history,null,2))}</pre>`).join('')+(activities.length?'':'<p>No activities in this section.</p>');
}
async function refreshDMDossierPages(actor,document,data) {
  requireGM();checkDMPack(game.packs?.get(dmPackId),{write:true});
  const contents=automaticPages(actor,data),names=['Character backups','Downtime — Active','Downtime — Completed','Downtime — Failed'];
  for(const name of names)if(Array.from(document.pages??[]).filter(page=>page.name===name).length>1)throw new Error('Duplicate downtime journal pages. Resolve duplicates before refreshing.');
  const missing=names.filter(name=>!Array.from(document.pages??[]).some(page=>page.name===name));
  if(missing.length)await document.createEmbeddedDocuments('JournalEntryPage',missing.map(name=>({name,type:'text',sort:dmPages.indexOf(name)*100000,text:{format:1,content:contents[name]}})));
  if(names.some(name=>!Array.from(document.pages??[]).some(page=>page.name===name)))throw new Error('Downtime page creation could not be verified.');
  const updates=Array.from(document.pages??[]).filter(page=>Object.hasOwn(contents,page.name)&&page.text?.content!==contents[page.name]).map(page=>({_id:page.id,'text.content':contents[page.name]}));
  if(updates.length)await document.updateEmbeddedDocuments('JournalEntryPage',updates);
  if(names.some(name=>Array.from(document.pages).find(page=>page.name===name)?.text?.content!==contents[name]))throw new Error('Downtime journal content could not be verified.');
}
export function stripDMExportNotes(html) {
  const edits=[...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].filter(match=>{
    const doc=new DOMParser().parseFromString(match[0],'text/html'),strong=doc.querySelector('strong')?.textContent.trim(),text=doc.body.textContent;
    return ['Before application','After application'].includes(strong)&&text.includes('Export requested (UTC):')&&text.includes('File: fvtt-Actor-')&&text.includes('.json');
  });
  const headings=[...html.matchAll(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi)].filter(match=>new DOMParser().parseFromString(match[0],'text/html').body.textContent.trim()==='Compagnon Manager — Export history');
  let result=html;for(const match of [...edits,...headings].sort((a,b)=>b.index-a.index))result=result.slice(0,match.index)+result.slice(match.index+match[0].length);
  return {html:result,entries:edits.map(match=>match[0])};
}
export async function saveDMDossier(actor,changes) {
  requireGM();const pack=checkDMPack(game.packs?.get(dmPackId),{write:true}),cached=dmDossiers.get(actor.uuid);
  if(!cached)throw new Error('Initialize / migrate this character in Summary first.');
  const current=dossierData(await pack.getDocument(cached.document.id),actor);
  if(current.revision!==cached.data.revision)throw new Error('Another DM changed this dossier. Reload it in Summary.');
  const data={...current,...copyDM(changes),updatedAt:new Date().toISOString(),revision:foundry.utils.randomID(32)};
  const result=await cached.document.update({'flags.world.companionManagerDM':data});
  if(!result)throw new Error('Private DM dossier could not be saved.');
  const verified=dossierData(await pack.getDocument(cached.document.id),actor);
  if(JSON.stringify(verified)!==JSON.stringify(data))throw new Error('Private DM dossier verification failed. Reload before retrying.');
  dmDossiers.set(actor.uuid,{document:cached.document,data:verified});
  try{await refreshDMDossierPages(actor,cached.document,verified);}catch(error){ui.notifications.warn(`Private data saved; generated journal pages could not be refreshed: ${error.message}`);}
  return verified;
}
export async function migrateDMDossier(actor) {
  requireGM();
  if(dossierBusy.has(actor.uuid))throw new Error('Dossier migration already in progress.');
  dossierBusy.add(actor.uuid);
  try {
    const pack=checkDMPack(game.packs?.get(dmPackId),{write:true});
    if(actor.flags?.world?.companionManager?.schema===2){await loadDMDossier(actor);const data=dmDossiers.get(actor.uuid).data;if(data.progression.active||data.characteristicPending||data.downtimePending||data.synchronizationPending||data.resynchronizationPending)throw new Error('Recover the interrupted manager operation before upgrading synchronization.');const document=dmDossiers.get(actor.uuid).document;if(data.synchronization)verifyDMExchange(actor);await cleanSharedManagerData(actor,document);await recordDMExchange(actor);await saveCharacterReference(actor,'Initialize / migrate character');return document;}
    checkNativeNotesSideEffects(actor);
    const progression=copyDM(managerState(actor)),oldHTML=actor.system.background.biography;
    if(progression.active)throw new Error('Finish the interrupted progression update using the previous macro before migration.');
    const stripped=stripDMExportNotes(oldHTML);
    const previousExports=stripped.entries.map(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html'),phase=doc.querySelector('strong').textContent;
      for(const br of doc.querySelectorAll('br'))br.replaceWith('\n');const lines=doc.body.textContent.split('\n');
      const field=prefix=>lines.find(line=>line.startsWith(prefix))?.slice(prefix.length).trim()??'';
      return {phase,at:field('Export requested (UTC):'),filename:field('File:'),dm:field('DM:')};
    }).slice(-5);
    const at=new Date().toISOString(),data={schema:1,actorUuid:actor.uuid,createdAt:at,updatedAt:at,revision:foundry.utils.randomID(32),progression,exports:previousExports,downtime:{schema:1,activities:[]},migration:{at,actorManagerFlags:copyDM(actor.flags?.world?.companionManager??null),exportNotes:stripped.entries}};
    // A failed actor cleanup may leave a complete dossier. Reuse only a matching
    // unpublished migration, never silently create a second dossier for an actor.
    const matches=(await pack.getDocuments()).filter(doc=>doc.flags?.world?.companionManagerDM?.actorUuid===actor.uuid);
    if(matches.length>1)throw new Error('Multiple dossiers exist for this character. Resolve the duplicate in the compendium first.');
    let document=matches[0];
    if(document) {
      const prior=dossierData(document,actor);
      if(JSON.stringify(prior.migration.actorManagerFlags)!==JSON.stringify(data.migration.actorManagerFlags)||JSON.stringify(prior.migration.exportNotes)!==JSON.stringify(data.migration.exportNotes))throw new Error('The saved migration differs from current actor data. Inspect the dossier before retrying.');
    } else {
      const contents=automaticPages(actor,data);
      document=await pack.documentClass.create({name:`${actor.name} — DM`,ownership:{default:0},flags:{world:{companionManagerDM:data}},pages:dmPages.map((name,index)=>({name,type:'text',sort:index*100000,text:{format:1,content:contents[name]??`<h2>${escapeHTML(name)}</h2><p>DM only. Add private information here.</p>`}}))},{pack:pack.collection});
    }
    const verified=dossierData(await pack.getDocument(document.id),actor);
    if(JSON.stringify(verified.progression)!==JSON.stringify(progression))throw new Error('Migration copy verification failed; character data preserved.');
    dmDossiers.set(actor.uuid,{document,data:verified});
    await cleanSharedManagerData(actor,document);await recordDMExchange(actor);await saveCharacterReference(actor,'Initialize / migrate character');
    return document;
  } finally {dossierBusy.delete(actor.uuid);}
}
async function cleanSharedManagerData(actor,document) {
    checkNativeNotesSideEffects(actor);
    const stripped=stripDMExportNotes(actor.system.background.biography);
    if(actor.flags?.world?.companionManager?.schema===2&&Object.keys(actor.flags.world.companionManager).every(key=>['schema','dossier','active'].includes(key))&&!stripped.entries.length&&readReadableDistribution(stripped.html,readPlayerActor(actor,game.user,'gm')).format===6)return;
    const publicState={schema:2,dossier:{pack:dmPackId,id:document.id},active:false};
    const patch={'flags.world.companionManager.schema':2,'flags.world.companionManager.dossier':publicState.dossier,'flags.world.companionManager.active':false};
    for(const key of Object.keys(actor.flags?.world?.companionManager??{}))if(!['schema','dossier','active'].includes(key))patch[`flags.world.companionManager.-=${key}`]=null;
    // Switching storage requires zeroing private counters in saved PC baselines.
    const snapshot={...readPlayerActor(actor,game.user,'gm'),privateManager:true};
    const loaded=readReadableDistribution(stripped.html,snapshot),draft=loaded.draft;
    if(loaded.present){for(const reward of draft.seasons??[])if(reward.start)reward.start.ticks=0;patch['system.background.biography']=writeReadableDistribution(stripped.html,draft,snapshot,game.user,loaded.fingerprint,foundry.utils.randomID(32));}
    else patch['system.background.biography']=stripped.html;
    requireGM();const result=await actor.update(patch);
    if(!result||actor.flags?.world?.companionManager?.schema!==2||Object.keys(actor.flags.world.companionManager).some(key=>!['schema','dossier','active'].includes(key)))throw new Error('Dossier copied; actor cleanup incomplete. Reload and retry migration.');
}
export async function persistManagerState(actor,store) {
  requireGM();
  if(actor.flags?.world?.companionManager?.schema!==2)throw new Error('Initialize / migrate this character in Summary before applying changes.');
  await saveDMDossier(actor,{progression:store});
  const active=Boolean(store.active);
  if(actor.flags.world.companionManager.active!==active) {
    checkNativeNotesSideEffects(actor);
    const updated=await actor.update({'flags.world.companionManager.active':active});
    if(!updated)throw new Error('Private state saved, but the shared update lock could not be set.');
  }
  if(!active)await saveCharacterReference(actor,'After progression application');
}

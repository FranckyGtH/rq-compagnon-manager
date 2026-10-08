import { saveCharacterReference } from './actor-reference.mjs';
import { requireGM } from './gm-application.mjs';
import { dmDossiers } from './manager-state.mjs';
import { saveDMDossier } from './dm-compendium.mjs';
import { ranges, checkNativeNotesSideEffects } from './distribution.mjs';
import { readPlayerActor } from './player-rules.mjs';
import { readReadableDistribution } from './readable-notes.mjs';

export function dmExchangeImage(actor) {
  const saved=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
  if(saved.format!==6)return null;
  return {schema:1,revision:saved.sharedRevision,publicPoints:ranges(actor.system.background.biography).POINTS.html,signature:dmPublicationSignature(ranges(actor.system.background.biography).POINTS.html)};
}
function dmPublicationSignature(html){const doc=new DOMParser().parseFromString(html,'text/html');return JSON.stringify([...doc.querySelectorAll('table')].map(table=>[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent.trim()))));}
export function verifyDMExchange(actor) {
  requireGM();if(actor.flags?.world?.companionManager?.schema!==2)return;const data=dmDossiers.get(actor.uuid)?.data;
  if(data?.resynchronizationPending)throw new Error('Recover character resynchronization in Summary first.');
  if(data?.synchronizationPending)throw new Error('Recover DM synchronization in Summary first.');
  const image=data?.synchronization;
  if(image){const current=dmExchangeImage(actor);if(!current||current.revision!==image.revision||current.signature!==(image.signature??dmPublicationSignature(image.publicPoints)))throw new Error('DM published information differs from its private synchronization. Reload / recover before continuing.');}
}
export async function recordDMExchange(actor) {
  requireGM();const image=dmExchangeImage(actor);if(!image)return;
  const previous=dmDossiers.get(actor.uuid)?.data.synchronization;
  if(previous?.revision===image.revision&&previous.publicPoints===image.publicPoints)return;
  await saveDMDossier(actor,{synchronization:{...image,at:new Date().toISOString(),dm:game.user.id}});
}
export async function publishDMExchange(actor,notes,fingerprint) {
  requireGM();verifyDMExchange(actor);
  const data=dmDossiers.get(actor.uuid)?.data;
  if(!data||data.progression.active||data.characteristicPending||data.downtimePending)throw new Error('Finish the interrupted manager operation before synchronizing.');
  const saved=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
  if(saved.fingerprint!==fingerprint)throw new Error('The request changed before DM synchronization. Reload it.');
  const next=readReadableDistribution(notes,readPlayerActor(actor,game.user,'gm'));
  checkNativeNotesSideEffects(actor);if(!await actor.update({'flags.world.companionManager.active':true}))throw new Error('Could not lock DM synchronization.');
  try{await saveDMDossier(actor,{synchronizationPending:{notes,fingerprint,revision:next.revision}});}catch(error){await actor.update({'flags.world.companionManager.active':false});throw error;}
  return resumeDMExchange(actor);
}
export async function resumeDMExchange(actor) {
  requireGM();const data=dmDossiers.get(actor.uuid)?.data,pending=data?.synchronizationPending;
  if(!pending)throw new Error('No DM synchronization needs recovery.');
  const snapshot=readPlayerActor(actor,game.user,'gm'),saved=readReadableDistribution(actor.system.background.biography,snapshot);
  if(saved.fingerprint!==pending.fingerprint&&saved.revision!==pending.revision)throw new Error('The shared request changed during synchronization. Inspect the DM dossier.');
  const target=ranges(pending.notes),current=ranges(actor.system.background.biography);let next=actor.system.background.biography;
  if(saved.revision!==pending.revision){
    if(!saved.present)next=pending.notes;
    else for(const kind of ['POINTS','WISHES'].sort((a,b)=>current[b].start-current[a].start))next=next.slice(0,current[kind].start)+target[kind].html+next.slice(current[kind].end);
    checkNativeNotesSideEffects(actor);if(!await actor.update({'system.background.biography':next}))throw new Error('DM publication failed. Recover synchronization in Summary.');
  }
  const verified=ranges(actor.system.background.biography);if(['POINTS','WISHES'].some(kind=>verified[kind]?.html!==target[kind].html))throw new Error('DM publication could not be verified. Recover synchronization in Summary.');
  const image=dmExchangeImage(actor);
  await saveDMDossier(actor,{synchronization:{...image,at:new Date().toISOString(),dm:game.user.id},synchronizationPending:null});
  checkNativeNotesSideEffects(actor);if(!await actor.update({'flags.world.companionManager.active':false}))throw new Error('DM synchronization saved; release the completed update lock in Summary.');
  await saveCharacterReference(actor,'DM publication');return actor;
}

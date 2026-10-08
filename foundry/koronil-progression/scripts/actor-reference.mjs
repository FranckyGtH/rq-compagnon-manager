import { requireGM } from './gm-application.mjs';
import { dmDossiers } from './manager-state.mjs';
import { saveDMDossier } from './dm-compendium.mjs';
import { verifyDMExchange, recordDMExchange } from './dm-synchronization.mjs';
import { readPlayerActor } from './player-rules.mjs';
import { readReadableDistribution, writeReadableDistribution } from './readable-notes.mjs';
import { ranges } from './distribution.mjs';
import { publicDowntimeActivity, validatePrivateActivity } from './downtime-rules.mjs';

const referenceCopy=value=>JSON.parse(JSON.stringify(value));
const referenceBusy=new Set();
const freeReferencePages=['Downtime — DM','Private notes'];
const privateReferenceKeys=['progression','downtime','migration','synchronization'];
function referenceCanonical(value) {
  if(Array.isArray(value))return value.map(referenceCanonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>key!=='_stats').sort().map(key=>[key,referenceCanonical(value[key])]));
  return value;
}
const referenceEqual=(a,b)=>JSON.stringify(referenceCanonical(a))===JSON.stringify(referenceCanonical(b));
function referenceNative(actor) {
  const data=referenceCopy(actor.toObject(true));
  data._id=actor.id;data.items=(data.items??[]).map(item=>{item._id??=item.id;delete item.id;return item;});
  data.effects=(data.effects??[]).map(effect=>{effect._id??=effect.id;delete effect.id;return effect;});
  return data;
}
function referencePrivate(data) {return Object.fromEntries(privateReferenceKeys.filter(key=>data[key]!==undefined).map(key=>[key,referenceCopy(data[key])]));}
export function referenceSnapshot(actor,reason='DM checkpoint') {
  requireGM();const cached=dmDossiers.get(actor.uuid);if(!cached)throw new Error('Initialize the private dossier first.');
  return {schema:1,id:foundry.utils.randomID(32),actorUuid:actor.uuid,at:new Date().toISOString(),dm:game.user.id,reason,foundryVersion:game.version,systemVersion:game.system.version,actor:referenceNative(actor),privateData:referencePrivate(cached.data),pages:Array.from(cached.document.pages??[]).filter(page=>freeReferencePages.includes(page.name)).map(page=>({name:page.name,content:page.text?.content??''}))};
}
export async function saveCharacterReference(actor,reason='DM checkpoint') {
  requireGM();const data=dmDossiers.get(actor.uuid)?.data;if(!data||actor.flags?.world?.companionManager?.schema!==2)return false;
  if(data.progression.active||data.characteristicPending||data.downtimePending||data.synchronizationPending||data.resynchronizationPending)return false;
  verifyDMExchange(actor);
  const previous=(data.characterBackups??[]).find(entry=>entry.id===data.characterReference),snapshot=referenceSnapshot(actor,reason);
  if(previous&&referenceEqual(previous.actor,snapshot.actor)&&referenceEqual(previous.privateData,snapshot.privateData)&&referenceEqual(previous.pages,snapshot.pages))return true;
  await saveDMDossier(actor,{characterBackups:[...(data.characterBackups??[]),snapshot].slice(-5),characterReference:snapshot.id});return true;
}
function validateReferenceActor(actor,data) {
  if(!data||data.type!=='character'||data._id!==actor.id||!data.system||typeof data.system.background?.biography!=='string'||!Array.isArray(data.items))throw new Error('The reference / export does not belong to this selected character or has an invalid Actor structure.');
  for(const list of [data.items,data.effects??[]]){const ids=new Set();if(!Array.isArray(list)||list.length>3000)throw new Error('Invalid embedded documents.');for(const item of list){const id=item._id??item.id;if(typeof id!=='string'||!id||ids.has(id)||typeof item.name!=='string')throw new Error('Invalid / duplicate embedded document ID.');ids.add(id);}}
}
export function readReferenceExport(actor,input) {
  requireGM();const data=typeof input==='string'?JSON.parse(input):referenceCopy(input);
  const bundle=data?.format==='CompagnonManagerDMBackup';
  if(bundle&&(data.schema!==1||data.systemVersion!==game.system.version||data.dossier?.flags?.world?.companionManagerDM?.actorUuid!==actor.uuid))throw new Error('Incompatible Manager backup or mismatched character.');
  const native=bundle?data.actor:data;validateReferenceActor(actor,native);
  const exportedPrivate=bundle?data.dossier.flags.world.companionManagerDM:null;if(native.flags?.world?.companionManager?.active||exportedPrivate?.progression?.active||['characteristicPending','downtimePending','synchronizationPending','resynchronizationPending'].some(key=>exportedPrivate?.[key]))throw new Error('This export contains an unfinished Manager operation. Choose a completed reference / export.');
  const privateData=bundle?referencePrivate(data.dossier.flags.world.companionManagerDM):referencePrivate(dmDossiers.get(actor.uuid).data);
  if(!bundle&&native._stats?.exportSource?.systemId&&native._stats.exportSource.systemId!==game.system.id)throw new Error('This native export uses another system.');
  if(!bundle&&native._stats?.exportSource?.systemVersion&&native._stats.exportSource.systemVersion!==game.system.version)throw new Error('This native export uses another system version.');
  const pages=bundle?(data.dossier.pages??[]).filter(page=>freeReferencePages.includes(page.name)).map(page=>({name:page.name,content:page.text?.content??''})):referenceSnapshot(actor).pages;
  return {schema:1,id:foundry.utils.randomID(32),actorUuid:actor.uuid,at:data.createdAt??new Date().toISOString(),reason:bundle?'Manager JSON backup':'Native Actor JSON (current private dossier retained)',actor:referenceCopy(native),privateData,pages};
}
export function characterResyncPlan(actor,{mode='reference',referenceId=null,exportData=null,clearRequests=true}={}) {
  requireGM();const cached=dmDossiers.get(actor.uuid);if(!cached)throw new Error('Initialize the DM dossier first.');
  let target;
  if(mode==='sheet')target=referenceSnapshot(actor,'Current sheet accepted by DM');
  else if(mode==='export')target=readReferenceExport(actor,exportData);
  else if(mode==='reference')target=referenceCopy((cached.data.characterBackups??[]).find(entry=>entry.id===(referenceId??cached.data.characterReference))??null);
  else throw new Error('Unknown resynchronization direction.');
  if(!target)throw new Error('No complete reference is stored yet. Accept the current sheet or select an export.');
  validateReferenceActor(actor,target.actor);
  if(target.privateData?.progression?.schema!==1||!Array.isArray(target.privateData.progression.history)||target.privateData.progression.active)throw new Error('The chosen reference contains an unfinished progression. Select a completed reference.');
  if(target.privateData.downtime?.schema!==1||!Array.isArray(target.privateData.downtime.activities))throw new Error('Invalid private downtime reference.');
  if(Object.values(target.privateData.progression.statTicks??{}).some(value=>!Number.isSafeInteger(value)||value<0||value>1000000))throw new Error('Invalid private characteristic counters in reference.');
  for(const activity of target.privateData.downtime.activities)validatePrivateActivity(activity);
  const current=referenceNative(actor),changes=[];
  for(const key of ['name','img','system','prototypeToken','flags'])if(!referenceEqual(current[key],target.actor[key]))changes.push(key==='system'?'Character data / notes / characteristics':'Character '+key);
  for(const [key,value]of Object.entries(target.actor.system.characteristics??{})){const before=current.system.characteristics?.[key];if(before&&!referenceEqual(before,value))changes.push(key+': '+before.value+' → '+value.value+'; Experience '+Boolean(before.hasExperience)+' → '+Boolean(value.hasExperience));}
  const beforeTicks=cached.data.progression.statTicks??{},afterTicks=target.privateData.progression.statTicks??{};for(const key of new Set([...Object.keys(beforeTicks),...Object.keys(afterTicks)]))if((beforeTicks[key]??0)!==(afterTicks[key]??0))changes.push('Private '+key+' ticks: '+(beforeTicks[key]??0)+' → '+(afterTicks[key]??0));
  const byId=new Map(current.items.map(item=>[item._id,item]));
  for(const item of target.actor.items){const old=byId.get(item._id??item.id);if(!old)changes.push('Add item: '+item.name);else if(!referenceEqual(old,item))changes.push('Restore item: '+item.name+'; '+(old.system?.chance??(old.system?.baseChance+old.system?.gainedChance)??'—')+' → '+(item.system?.chance??(item.system?.baseChance+item.system?.gainedChance)??'—'));byId.delete(item._id??item.id);}
  for(const item of byId.values())changes.push('Remove item: '+item.name);
  if(!referenceEqual(current.effects??[],target.actor.effects??[]))changes.push('Restore actor effects');
  if(!referenceEqual(referencePrivate(cached.data),target.privateData))changes.push('Restore private ticks, downtime and progression history');
  if(mode==='sheet'){
    let loaded;try{loaded=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));}catch(error){if(!clearRequests)throw error;referenceRepairDraft(target.privateData);loaded={present:true};}
    if(!loaded.present)throw new Error('The current sheet has no distribution to synchronize. Assign budgets first, or restore a reference / export.');
  }
  return {id:foundry.utils.randomID(32),actorUuid:actor.uuid,mode,target,clearRequests,changes,before:current,dossierRevision:cached.data.revision};
}
async function reconcileReferenceDocuments(parent,type,targets) {
  const collection=type==='Item'?parent.items:parent.effects;
  const existing=Array.from(collection??[]),targetIds=new Set(targets.map(item=>item._id??item.id));
  const remove=existing.filter(item=>!targetIds.has(item.id??item._id)||targets.some(target=>(target._id??target.id)===(item.id??item._id)&&target.type!==item.type)).map(item=>item.id??item._id);
  if(remove.length)await parent.deleteEmbeddedDocuments(type,remove);
  for(const source of targets) {
    requireGM();const id=source._id??source.id,current=Array.from(type==='Item'?parent.items:parent.effects??[]).find(item=>(item.id??item._id)===id),payload=referenceCopy(source);payload._id=id;delete payload.id;delete payload._stats;
    if(!current)await parent.createEmbeddedDocuments(type,[payload],{keepId:true});
    else {const saved=current.toObject?current.toObject(true):{...referenceCopy(current),_id:id};delete saved.id;if(!referenceEqual(saved,payload))await parent.updateEmbeddedDocuments(type,[payload],{diff:false,recursive:false});}
  }
}
export async function applyCharacterResync(actor,plan) {
  requireGM();if(referenceBusy.has(actor.uuid))throw new Error('Character resynchronization already running.');referenceBusy.add(actor.uuid);
  try {
    const cached=dmDossiers.get(actor.uuid);
    if(plan.actorUuid!==actor.uuid||cached.data.revision!==plan.dossierRevision||!referenceEqual(referenceNative(actor),plan.before))throw new Error('Character or dossier changed after preview. Review resynchronization again.');
    const before=referenceSnapshot(actor,'Before forced resynchronization');
    await saveDMDossier(actor,{characterBackups:[...(cached.data.characterBackups??[]),before].slice(-5),resynchronizationPending:{schema:1,plan,stage:'native',startedAt:new Date().toISOString()}});
    return await resumeCharacterResync(actor);
  }finally{referenceBusy.delete(actor.uuid);}
}
export async function resumeCharacterResync(actor) {
  requireGM();let pending=dmDossiers.get(actor.uuid)?.data.resynchronizationPending;
  if(!pending||pending.plan.actorUuid!==actor.uuid)throw new Error('No character resynchronization needs recovery.');
  const {plan}=pending,target=referenceCopy(plan.target),privateData=target.privateData;
  await actor.update({'flags.world.companionManager.active':true});
  if(pending.stage==='native') {
    if(plan.mode!=='sheet'){
      const flags=referenceCopy(target.actor.flags??{});flags.world??={};flags.world.companionManager={schema:2,dossier:referenceCopy(actor.flags.world.companionManager.dossier),active:true};
      const patch={};for(const key of ['name','img','system','prototypeToken'])if(target.actor[key]!==undefined)patch[key]=referenceCopy(target.actor[key]);patch.flags=flags;
      if(!await actor.update(patch,{diff:false,recursive:false}))throw new Error('Native actor restoration failed. Resume in Summary.');
      await reconcileReferenceDocuments(actor,'Item',target.actor.items);
      await reconcileReferenceDocuments(actor,'ActiveEffect',target.actor.effects??[]);
      const restored=referenceNative(actor);if(!referenceEqual(restored.flags,flags))throw new Error('Restored Actor flags could not be verified. Resume / review the source.');
      for(const key of ['name','img','system','prototypeToken'])if(target.actor[key]!==undefined&&!referenceEqual(restored[key],target.actor[key]))throw new Error('Restored '+key+' differs from its reference. Resume or review the source.');
      const normalized=list=>list.map(item=>{const value=referenceCopy(item);value._id??=value.id;delete value.id;return value;}).sort((a,b)=>a._id.localeCompare(b._id));
      if(!referenceEqual(normalized(restored.items),normalized(target.actor.items))||!referenceEqual(normalized(restored.effects??[]),normalized(target.actor.effects??[])))throw new Error('Restored items / effects could not be verified. Resume in Summary.');
    }
    const snapshot=readPlayerActor(actor,game.user,'gm');let loaded,draft;
    try{loaded=readReadableDistribution(actor.system.background.biography,snapshot);draft=loaded.draft;}catch(error){if(!plan.clearRequests)throw error;draft=referenceRepairDraft(privateData);const blocks=ranges(actor.system.background.biography);let outside=actor.system.background.biography;for(const kind of ['POINTS','WISHES'].filter(k=>blocks[k]).sort((a,b)=>blocks[b].start-blocks[a].start))outside=outside.slice(0,blocks[kind].start)+outside.slice(blocks[kind].end);loaded=readReadableDistribution(outside,snapshot);pending={...pending,repairOutside:outside};}

    draft.downtime??={activities:[],requests:[]};draft.downtime.activities=(privateData.downtime?.activities??[]).map(publicDowntimeActivity);
    if(plan.clearRequests){draft.entries=[];draft.downtime.requests=[];for(const reward of draft.seasons??[]){reward.choice='pending';reward.stat=null;reward.start=null;}}
    else for(const request of draft.downtime.requests){const activity=draft.downtime.activities.find(a=>a.id===request.id);if(activity)request.revision=activity.revision;}
    const notes=writeReadableDistribution(pending.repairOutside??actor.system.background.biography,draft,snapshot,game.user,loaded.fingerprint,foundry.utils.randomID(32));
    pending={...pending,stage:'publication',notes};await saveDMDossier(actor,{resynchronizationPending:pending});
  }
  if(pending.stage==='publication') {
    if(actor.system.background.biography!==pending.notes&&!await actor.update({'system.background.biography':pending.notes}))throw new Error('Resynchronization publication failed. Resume in Summary.');
    if(actor.system.background.biography!==pending.notes)throw new Error('Resynchronization notes verification failed.');
    const changes={...referencePrivate(privateData),characteristicPending:null,downtimePending:null,synchronizationPending:null};
    if(changes.progression)changes.progression.active=null;
    await saveDMDossier(actor,changes);
    const document=dmDossiers.get(actor.uuid).document,updates=Array.from(document.pages??[]).filter(page=>target.pages.some(saved=>saved.name===page.name)).map(page=>({_id:page.id,'text.content':target.pages.find(saved=>saved.name===page.name).content}));
    if(updates.length)await document.updateEmbeddedDocuments('JournalEntryPage',updates);
    await recordDMExchange(actor);
    pending={...pending,stage:'unlock'};await saveDMDossier(actor,{resynchronizationPending:pending});
  }
  await actor.update({'flags.world.companionManager.active':false});
  await saveDMDossier(actor,{resynchronizationPending:null});
  await saveCharacterReference(actor,'After forced resynchronization');
  return plan;
}

function referenceRepairDraft(privateData) {
  const html=privateData.synchronization?.publicPoints;if(typeof html!=='string')throw new Error('There is no valid private publication to repair these notes. Choose a complete reference / export.');
  const doc=new DOMParser().parseFromString(html,'text/html'),tables=[...doc.querySelectorAll('table')];
  const rows=table=>[...table.rows].slice(1).map(row=>[...row.cells].map(cell=>cell.textContent.trim()));
  if(tables.length!==5)throw new Error('Private publication cannot repair the damaged notes.');
  const budgets=rows(tables[1]);if(budgets.map(row=>row[0]).join('|')!=='XP|TP|DP')throw new Error('Private reference budgets are invalid.');
  const settings=rows(tables[3]);if(settings.map(row=>row[0]).join('|')!=='Initial DEX|Species maximum')throw new Error('Private training settings are invalid.');
  return {amounts:Object.fromEntries(budgets.map(row=>[row[0].toLowerCase(),Number(row[1])])),entries:[],seasons:rows(tables[2]).map(row=>({id:row[0],season:row[1],choice:'pending',stat:null,start:null})),training:{initialDex:settings[0][1]==='—'?null:Number(settings[0][1]),speciesMaximum:settings[1][1]==='—'?null:Number(settings[1][1])},downtime:{activities:(privateData.downtime?.activities??[]).map(publicDowntimeActivity),requests:[]}};
}

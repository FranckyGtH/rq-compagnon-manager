import { recordDMExchange, verifyDMExchange } from './dm-synchronization.mjs';
import { requireGM } from './gm-application.mjs';
import { readPlayerActor, projectedValues, validatePlayerDraft, trainingProgressionDraft } from './player-rules.mjs';
import { readReadableDistribution, submittedPlayerDraft, writeReadableDistribution } from './readable-notes.mjs';
import { checkNativeNotesSideEffects } from './distribution.mjs';
import { validateSeasonTraining, progressionMarkdown } from './season-training.mjs';
import { managerState, dmDossiers } from './manager-state.mjs';
import { persistManagerState } from './dm-compendium.mjs';

import { downtimePlan, applyDowntimePlan, verifyDowntimePlan } from './downtime-dm.mjs';
import { publicDowntimeActivity } from './downtime-rules.mjs';
const transactionPath='flags.world.companionManager';
const inFlight=new Set();
export function transactionStore(actor) {
  const store=managerState(actor);
  if(!store)return {schema:1,active:null,history:[]};
  if(store.schema!==1||!Array.isArray(store.history))throw new Error('Unrecognized progression history. Update blocked.');
  return JSON.parse(JSON.stringify(store));
}
const savedField=(item,key)=>item._source?.system?.[key]??item.system?.[key];
const itemById=(actor,id)=>Array.from(actor.items).find(item=>(item.id??item._id)===id);
async function finishPrivateCleanup(actor,tx,user) {
  requireGM();
  const current=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,user,'gm'));
  if(current.fingerprint!==tx.plan.fingerprint&&current.revision!==tx.clearedRevision)throw new Error('Saved notes changed during cleanup. Reload the DM dossier.');
  for(const change of tx.plan.changes)for(const [key,value]of Object.entries(change.after))if(savedField(itemById(actor,change.id),key)!==value)throw new Error('Applied progression changed before cleanup recovery.');
  for(const change of tx.plan.statChanges??[])if(readPlayerActor(actor,user,'gm').characteristics[change.key].ticks!==change.after.ticks)throw new Error('Applied characteristic counters changed before cleanup recovery.');
  if(tx.plan.downtimeChanges)verifyDowntimePlan(actor,tx.plan.downtimeChanges);
  if(current.revision!==tx.clearedRevision){checkNativeNotesSideEffects(actor);if(!await actor.update({'system.background.biography':tx.cleanupNotes}))throw new Error('Request cleanup failed. Resume the update.');}
  const published=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,user,'gm'));
  if(published.revision!==tx.clearedRevision||published.draft.entries.length||(published.draft.seasons??[]).length||Object.values(published.draft.amounts).some(value=>value!==0)||(published.draft.downtime?.requests??[]).length)throw new Error('Final publication could not be verified. Resume the update.');
  if(tx.plan.downtimeChanges&&JSON.stringify(published.draft.downtime?.activities)!==JSON.stringify(tx.plan.downtimeChanges.after.map(publicDowntimeActivity)))throw new Error('Published downtime does not match the complete DM dossier. Resume the update.');
  const completed={...tx,status:'complete',completedAt:new Date().toISOString()};delete completed.cleanupNotes;
  const store=transactionStore(actor);store.active=null;if(!store.history.some(entry=>entry.id===tx.id))store.history.push(completed);
  await recordDMExchange(actor);await persistManagerState(actor,store);return completed;
}
export function progressionPlan(actor,user=game.user) {
  requireGM(user);verifyDMExchange(actor);
  if(dmDossiers.get(actor.uuid)?.data.characteristicPending)throw new Error('Recover the interrupted characteristic update in Summary first.');
  if(dmDossiers.get(actor.uuid)?.data.downtimePending)throw new Error('Recover downtime publication in Summary first.');
  checkNativeNotesSideEffects(actor);
  const snapshot=readPlayerActor(actor,user,'gm');
  const saved=readReadableDistribution(actor.system.background.biography,snapshot);
  if(saved.origin!=='GM declaration')throw new Error('The DM must assign the budgets and save the distribution before applying it.');
  const draft=submittedPlayerDraft(saved.draft,snapshot);
  const balances=validatePlayerDraft(draft,snapshot),projected=projectedValues(draft,snapshot);
  validateSeasonTraining(draft,snapshot,{requireChoices:true});
  if(!draft.entries.some(entry=>entry.xp||entry.tp)&&!(draft.seasons??[]).some(reward=>reward.choice==='stat')&&!(draft.downtime?.requests.length))throw new Error('No XP, TP or characteristic tick allocation is saved.');
  // Verify and retain the complete activity collection, even in an XP/TP-only cycle.
  const downtimeChanges=draft.downtime?downtimePlan(actor,draft):null;
  const increments={};for(const reward of draft.seasons??[])if(reward.choice==='stat')increments[reward.stat]=(increments[reward.stat]??0)+1;
  const statChanges=Object.entries(increments).map(([key,count])=>({key,before:{...snapshot.characteristics[key]},after:{ticks:snapshot.characteristics[key].ticks+count,checked:snapshot.characteristics[key].checked}}));
  const changes=[];
  const effective=trainingProgressionDraft(draft,snapshot);
  const styleMembers=new Set((snapshot.styles??[]).filter(style=>effective.entries.some(entry=>entry.itemId===style.id&&(entry.xp||entry.tp))).flatMap(style=>style.members));
  for(const [id,next]of projected) {
    const item=itemById(actor,id),entry=effective.entries.find(entry=>entry.itemId===id);
    const before={hasExperience:savedField(item,'hasExperience')===true};
    const after={hasExperience:styleMembers.has(id)||entry&&(entry.xp||entry.tp)?false:before.hasExperience};
    if(item.type==='skill') {
      before.gainedChance=savedField(item,'gainedChance');
      after.gainedChance=next.raw-savedField(item,'baseChance');
      if(!Number.isSafeInteger(after.gainedChance)||after.gainedChance<0)throw new Error(`${item.name}: invalid acquired skill value.`);
    } else {before.chance=savedField(item,'chance');after.chance=next.raw;}
    if(Object.keys(before).some(key=>before[key]!==after[key]))changes.push({id,type:item.type,name:item.name,before,after,rawAfter:next.raw,...(styleMembers.has(id)||snapshot.styles?.some(style=>style.id===id)?{baseBefore:savedField(item,'baseChance'),fullAfter:next.full}: {})});
  }
  const styleChecks=[...styleMembers].map(id=>({id,baseBefore:savedField(itemById(actor,id),'baseChance'),fullAfter:projected.get(id).full,rawAfter:projected.get(id).raw}));
  const summaryDraft=downtimeChanges?{...draft,downtime:{...draft.downtime,activities:downtimeChanges.after.map(publicDowntimeActivity)}}:draft;
  return {actorUuid:actor.uuid,revision:saved.revision,fingerprint:saved.fingerprint,draft,balances,changes,styleChecks,statChanges,downtimeChanges,markdownSummary:progressionMarkdown(summaryDraft,snapshot,null,downtimeChanges?.conversions??[])};
}
async function storeTransaction(actor,store) {
  requireGM();checkNativeNotesSideEffects(actor);
  if(actor.flags?.world?.companionManager?.schema===2)return persistManagerState(actor,store);
  const result=await actor.update({[transactionPath]:store});
  if(!result)throw new Error('Progression history could not be saved.');
}
export async function applyProgression(actor,user=game.user,expectedFingerprint=null) {
  requireGM(user);
  if(inFlight.has(actor.uuid))throw new Error('This character is already being updated in this browser.');
  inFlight.add(actor.uuid);
  let tx;
  try {
    let store=transactionStore(actor);
    tx=store.active;
    if(tx?.cleanupNotes)return await finishPrivateCleanup(actor,tx,user);
    if(!tx) {
      const plan=progressionPlan(actor,user);
      if(expectedFingerprint!==null&&plan.fingerprint!==expectedFingerprint)throw new Error('The distribution changed after confirmation. Reload and review it before applying.');
      tx={id:globalThis.crypto?.randomUUID?.()??foundry.utils.randomID(32),status:'started',startedAt:new Date().toISOString(),userId:user.id,plan};
      store.active=tx;await storeTransaction(actor,store);
    }
    if(expectedFingerprint!==null&&tx.plan?.fingerprint!==expectedFingerprint)throw new Error('The transaction changed after confirmation. Review it before resuming.');
    if(tx.plan?.actorUuid!==actor.uuid||!Array.isArray(tx.plan.changes))throw new Error('Invalid pending transaction. Ask the DM to inspect the history or restore the backup.');
    const fence=()=>{
      requireGM();
      if(transactionStore(actor).active?.id!==tx.id)throw new Error('Another DM changed the transaction. Update stopped.');
      const current=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,user,'gm'));
      if(current.fingerprint!==tx.plan.fingerprint)throw new Error('The saved request changed during the update. Notes and points were preserved.');
    };
    fence();
    // Absolute targets make retries idempotent. A native rune update may already
    // have changed its companion; each field can be in its recorded before/after state.
    for(const change of tx.plan.changes) {
      fence();
      const item=itemById(actor,change.id);
      if(!item||item.type!==change.type)throw new Error(`${change.name}: item missing or replaced.`);
      if(change.baseBefore!==undefined&&savedField(item,'baseChance')!==change.baseBefore)throw new Error(`${change.name}: base chance changed during the combat style update.`);
      const patch={_id:change.id};
      for(const [key,value]of Object.entries(change.after)) {
        const current=savedField(item,key);
        if(current!==change.before[key]&&current!==value)throw new Error(`${change.name}: ${key} changed outside this transaction. Update stopped.`);
        if(current!==value)patch[`system.${key}`]=value;
      }
      if(Object.keys(patch).length>1)await actor.updateEmbeddedDocuments('Item',[patch]);
      // Never batch multiple runes: RQG 6.1.1 resolves opposing runes per update.
    }
    fence();
    for(const change of tx.plan.statChanges??[]) {
      fence();
      const current=readPlayerActor(actor,user,'gm').characteristics[change.key];
      if(!current||current.value!==change.before.value||![change.before.checked,change.after.checked].includes(current.checked)||![change.before.ticks,change.after.ticks].includes(current.ticks))throw new Error('A characteristic or tick counter changed outside this transaction.');
      if(current.checked!==change.after.checked||current.ticks!==change.after.ticks) {
        checkNativeNotesSideEffects(actor);
        const nextStore=transactionStore(actor);nextStore.statTicks??={};nextStore.statTicks[change.key]=change.after.ticks;
        const updated=actor.flags?.world?.companionManager?.schema===2?await persistManagerState(actor,nextStore).then(()=>true):await actor.update({[`system.characteristics.${change.key}.hasExperience`]:change.after.checked,[transactionPath]:nextStore});
        if(!updated)throw new Error('Characteristic tick update failed. Resume the update.');
      }
    }
    fence();
    if(tx.plan.downtimeChanges){await applyDowntimePlan(actor,tx.plan.downtimeChanges);verifyDowntimePlan(actor,tx.plan.downtimeChanges);fence();}
    for(const change of tx.plan.statChanges??[]) {
      const current=readPlayerActor(actor,user,'gm').characteristics[change.key];
      if(current.value!==change.before.value||current.checked!==change.after.checked||current.ticks!==change.after.ticks)throw new Error('Characteristic ticks could not be verified.');
    }
    for(const change of tx.plan.changes)for(const [key,value]of Object.entries(change.after))if(savedField(itemById(actor,change.id),key)!==value)throw new Error(`${change.name}: updated values could not be verified.`);
    for(const change of tx.plan.changes)if(change.fullAfter!==undefined&&itemById(actor,change.id).system.chance!==change.fullAfter)throw new Error(`${change.name}: full combat style value could not be verified. Points and wishes are retained.`);
    for(const check of tx.plan.styleChecks??[]) {
      const item=itemById(actor,check.id);
      if(!item||savedField(item,'baseChance')!==check.baseBefore||savedField(item,'baseChance')+savedField(item,'gainedChance')!==check.rawAfter||item.system.chance!==check.fullAfter||savedField(item,'hasExperience')===true)throw new Error('Combat style members could not all be verified. Points and wishes are retained.');
    }
    store=transactionStore(actor);tx.status='verified';tx.verifiedAt=new Date().toISOString();delete tx.error;store.active=tx;await storeTransaction(actor,store);
    fence();
    const snapshot=readPlayerActor(actor,user,'gm');
    const cleared={amounts:{xp:0,tp:0,dp:0},entries:[],...(tx.plan.draft.seasons?{seasons:[],training:tx.plan.draft.training}:{}),...(tx.plan.draft.downtime?{downtime:{activities:tx.plan.downtimeChanges?tx.plan.downtimeChanges.after.map(publicDowntimeActivity):tx.plan.draft.downtime.activities,requests:[]}}:{})};
    const revision=globalThis.crypto?.randomUUID?.()??foundry.utils.randomID(32);
    const next=writeReadableDistribution(actor.system.background.biography,cleared,snapshot,user,tx.plan.fingerprint,revision);
    if(actor.flags?.world?.companionManager?.schema===2) {
      tx.clearedRevision=revision;tx.cleanupNotes=next;tx.status='cleanup-ready';store=transactionStore(actor);store.active=tx;
      await storeTransaction(actor,store);return await finishPrivateCleanup(actor,tx,user);
    }
    tx.status='complete';tx.completedAt=new Date().toISOString();tx.clearedRevision=revision;
    store=transactionStore(actor);store.active=null;store.history.push(tx);
    checkNativeNotesSideEffects(actor);
    // Keep the private active transaction until shared cleanup succeeds. If the
    // final private save fails, a retry recognizes the cleared revision below.
    const cleaned=await actor.update({'system.background.biography':next,...(actor.flags?.world?.companionManager?.schema===2?{}:{[transactionPath]:store})});
    if(!cleaned)throw new Error('Values are updated, but request cleanup failed. Resume the update to finish; do not apply gains manually again.');
    if(actor.flags?.world?.companionManager?.schema===2)await persistManagerState(actor,store);
    const check=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,user,'gm'));
    if(check.revision!==revision||check.draft.entries.length||(check.draft.seasons??[]).length||Object.values(check.draft.amounts).some(value=>value!==0)||transactionStore(actor).active)throw new Error('Final cleanup could not be verified. Check the history before continuing.');
    return tx;
  } catch(error) {
    if(tx&&transactionStore(actor).active?.id===tx.id) {
      const store=transactionStore(actor);store.active.status='needs-recovery';store.active.error=error.message;
      try{await storeTransaction(actor,store);}catch{/* Existing active transaction still blocks a fresh apply. */}
    }
    throw error;
  } finally {inFlight.delete(actor.uuid);}
}

import { saveCharacterReference } from './actor-reference.mjs';
import { verifyDMExchange } from './dm-synchronization.mjs';
import { requireGM } from './gm-application.mjs';
import { transactionStore } from './apply-progression.mjs';
import { readPlayerActor } from './player-rules.mjs';
import { readReadableDistribution } from './readable-notes.mjs';
import { characteristicOptions, defaultTraining } from './season-training.mjs';
import { checkNativeNotesSideEffects } from './distribution.mjs';
import { saveDMDossier } from './dm-compendium.mjs';
import { dmDossiers } from './manager-state.mjs';

export const allCharacteristics={strength:'STR',constitution:'CON',size:'SIZ',dexterity:'DEX',intelligence:'INT',power:'POW',charisma:'CHA'};
const characteristicBusy=new Set();
export function characteristicCost(value,maximum,rule) {
  if(!Number.isSafeInteger(value)||!Number.isSafeInteger(maximum)||value>=maximum)return null;
  if(rule==='table21'&&maximum===21)return value<=9?1:value<=15?2:value<=17?3:value<=19?4:5;
  return null;
}
export function characteristicRows(snapshot,training,rule) {
  const options=characteristicOptions(snapshot,training);
  return Object.entries(allCharacteristics).map(([key,label])=>{
    const current=snapshot.characteristics[key],option=options.find(row=>row.key===key);
    // Tick cost uses the species maximum; the DEX cap only limits eligibility.
    const cost=option&&!option.reason?characteristicCost(current?.value,training.speciesMaximum,rule):null;
    const reason=!option?'Cannot be trained':option.reason||(!rule?'Choose the tick cost rule':cost===null?'Tick table only supports a species maximum of 21':'');
    return {key,label,value:current?.value,ticks:current?.ticks??0,checked:current?.checked===true,maximum:option?.maximum??training.speciesMaximum,cost,reason,eligible:!reason&&current.ticks>=cost};
  });
}
export function characteristicPlan(actor,{mode,forced={},rule},user=game.user) {
  requireGM(user);
  if(actor?.type!=='character'||actor.isToken||actor.isEmbedded||actor.inCompendium)throw new Error('Select a world character.');
  const store=transactionStore(actor);
  if(store.active)throw new Error('Resume the interrupted progression update first.');
  verifyDMExchange(actor);
  if(dmDossiers.get(actor.uuid)?.data.downtimePending)throw new Error('Recover downtime publication in Summary first.');
  if(dmDossiers.get(actor.uuid)?.data.characteristicPending)throw new Error('Recover the interrupted characteristic update in Summary first.');
  const snapshot=readPlayerActor(actor,user,'gm'),saved=readReadableDistribution(actor.system.background.biography,snapshot);
  if(saved.draft.seasons?.some(reward=>reward.choice==='stat'))throw new Error('Apply or remove the saved seasonal stat tick requests before changing characteristic counters or values.');
  if(!['force','increase','collect'].includes(mode)||rule!=='table21')throw new Error('Invalid characteristic operation.');
  if(mode==='increase'&&!rule)throw new Error('Choose the tick cost rule.');
  const training=saved.draft.training??defaultTraining(snapshot);
  const rows=characteristicRows(snapshot,training,rule),changes=[];
  for(const key of Object.keys(forced))if(!allCharacteristics[key])throw new Error('Unknown characteristic counter.');
  for(const row of rows) {
    const before=snapshot.characteristics[row.key];
    if(!before||!Number.isSafeInteger(before.value)||!Number.isSafeInteger(before.ticks)||before.ticks<0)throw new Error(`${row.label}: invalid characteristic data.`);
    if(mode==='collect'&&before.checked===true) {
      if(before.ticks>=1000000)throw new Error(`${row.label}: tick counter limit reached.`);
      changes.push({key:row.key,label:row.label,before,after:{value:before.value,ticks:before.ticks+1,checked:false},spent:0});
    } else if(mode==='force'&&Object.hasOwn(forced,row.key)) {
      const ticks=forced[row.key];
      if(!Number.isSafeInteger(ticks)||ticks<0||ticks>1000000)throw new Error(`${row.label}: enter a whole tick count from 0 to 1000000.`);
      if(ticks!==before.ticks||store.statTicks?.[row.key]===undefined)changes.push({key:row.key,label:row.label,before,after:{value:before.value,ticks,checked:before.checked},spent:0});
    } else if(mode==='increase'&&row.eligible) {
      const ticks=before.ticks-row.cost;
      changes.push({key:row.key,label:row.label,before,after:{value:before.value+1,ticks,checked:before.checked},spent:row.cost});
    }
  }
  if(!changes.length)throw new Error(mode==='collect'?'No characteristic Experience toggle is checked.':mode==='increase'?'No characteristic has enough ticks below its maximum.':'No tick counter changes entered.');
  return {mode,rule,changes,training,notes:saved.fingerprint,baseline:snapshot.characteristics};
}
export async function applyCharacteristics(actor,options,user=game.user,expected=null) {
  requireGM(user);requireGM();
  if(characteristicBusy.has(actor.uuid))throw new Error('Characteristic update already in progress.');
  characteristicBusy.add(actor.uuid);
  try {
    const plan=characteristicPlan(actor,options,user);
    if(expected&&JSON.stringify(plan)!==JSON.stringify(expected))throw new Error('Characteristics, notes or counters changed after confirmation. Reload and review again.');
    checkNativeNotesSideEffects(actor);
    const store=transactionStore(actor),patch={};store.statTicks??={};store.characteristicRule=plan.rule;
    for(const change of plan.changes) {
      store.statTicks[change.key]=change.after.ticks;
      patch[`system.characteristics.${change.key}.hasExperience`]=change.after.checked;
      if(change.after.value!==change.before.value)patch[`system.characteristics.${change.key}.value`]=change.after.value;
    }
    store.characteristicHistory=[...(store.characteristicHistory??[]),{at:new Date().toISOString(),dm:user.id,mode:plan.mode,rule:plan.rule,changes:plan.changes}].slice(-20);
    patch['flags.world.companionManager']=store;
    requireGM();
    if(actor.flags?.world?.companionManager?.schema===2) {
      delete patch['flags.world.companionManager'];
      // Private counters are absolute targets. Keep a recovery record before a
      // separate native actor write, and finish counters only after that write.
      await saveDMDossier(actor,{characteristicPending:{options,plan,store}});
      patch['flags.world.companionManager.active']=true;
    }
    const result=await actor.update(patch);
    if(!result)throw new Error('Characteristic update could not be saved. Reload the sheet before retrying.');
    if(actor.flags?.world?.companionManager?.schema===2)await saveDMDossier(actor,{progression:store,characteristicPending:null});
    if(actor.flags?.world?.companionManager?.schema===2)await actor.update({'flags.world.companionManager.active':false});
    const after=readPlayerActor(actor,user,'gm');
    if(plan.changes.some(change=>after.characteristics[change.key].value!==change.after.value||after.characteristics[change.key].ticks!==change.after.ticks||after.characteristics[change.key].checked!==change.after.checked))throw new Error('Characteristic update verification failed. Reload and inspect the sheet before retrying.');
    await saveCharacterReference(actor,'After characteristic update');return plan;
  } finally {characteristicBusy.delete(actor.uuid);}
}
export async function resumeCharacteristics(actor) {
  requireGM();
  const pending=dmDossiers.get(actor.uuid)?.data.characteristicPending;
  if(!pending)throw new Error('No characteristic update needs recovery.');
  const saved=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
  if(saved.fingerprint!==pending.plan.notes)throw new Error('Request notes changed during the characteristic update. Inspect the dossier before recovery.');
  const current=readPlayerActor(actor,game.user,'gm'),patch={};
  for(const change of pending.plan.changes) {
    const now=current.characteristics[change.key];
    if(![change.before.value,change.after.value].includes(now.value)||![change.before.checked,change.after.checked].includes(now.checked)||![change.before.ticks,change.after.ticks].includes(now.ticks))throw new Error('A characteristic changed outside the recorded update. Inspect the dossier.');
    patch[`system.characteristics.${change.key}.value`]=change.after.value;patch[`system.characteristics.${change.key}.hasExperience`]=change.after.checked;
  }
  checkNativeNotesSideEffects(actor);
  if(!await actor.update(patch))throw new Error('Native characteristic recovery failed.');
  await saveDMDossier(actor,{progression:pending.store,characteristicPending:null});
  await actor.update({'flags.world.companionManager.active':false});await saveCharacterReference(actor,'Recovered characteristic update');
}

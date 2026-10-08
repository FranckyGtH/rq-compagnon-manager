import { saveCharacterReference } from './actor-reference.mjs';
import { verifyDMExchange, recordDMExchange } from './dm-synchronization.mjs';
import { requireGM } from './gm-application.mjs';
import { dmDossiers } from './manager-state.mjs';
import { transactionStore } from './apply-progression.mjs';
import { saveDMDossier, persistManagerState } from './dm-compendium.mjs';
import { readPlayerActor, projectedValues, validatePlayerDraft } from './player-rules.mjs';
import { readReadableDistribution, writeReadableDistribution } from './readable-notes.mjs';
import { checkNativeNotesSideEffects } from './distribution.mjs';
import { emptyDowntime, publicDowntimeActivity, validateDowntime, validatePrivateActivity, convertedTrainingDP } from './downtime-rules.mjs';

const dtCopy=value=>JSON.parse(JSON.stringify(value));
const downtimeBusy=new Set();
export function privateDowntime(actor) {
  requireGM();const data=dmDossiers.get(actor.uuid)?.data;
  if(!data)throw new Error('Initialize / migrate the character in Summary first.');
  const value=data.downtime??{schema:1,activities:[]};
  if(value.schema!==1||!Array.isArray(value.activities)||value.activities.length>300)throw new Error('Invalid private downtime store.');
  const ids=new Set();for(const activity of value.activities){validatePrivateActivity(activity);if(ids.has(activity.id))throw new Error('Duplicate private downtime activity.');ids.add(activity.id);}
  return dtCopy(value);
}
function assertDowntimeIdle(actor) {
  requireGM();verifyDMExchange(actor);
  if(actor.flags?.world?.companionManager?.active||transactionStore(actor).active||dmDossiers.get(actor.uuid)?.data.characteristicPending||dmDossiers.get(actor.uuid)?.data.downtimePending)throw new Error('Recover the interrupted manager operation before changing downtime details.');
}
export function trainingConversionPlan(actor,id,dp) {
  requireGM();assertDowntimeIdle(actor);
  const activity=privateDowntime(actor).activities.find(item=>item.id===id);
  if(!activity||activity.type!=='training')throw new Error('Select an invested Training activity.');
  if(!['open','complete'].includes(activity.status))throw new Error('Failed or cancelled Training cannot be converted.');
  const converted=convertedTrainingDP(activity),available=activity.invested-converted;
  if(!Number.isSafeInteger(dp)||dp<1||dp>available)throw new Error(`Enter a whole DP amount from 1 to ${available}. Only invested, unconverted DP can produce TP.`);
  const loaded=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
  if(JSON.stringify(loaded.draft.downtime?.activities??[])!==JSON.stringify(privateDowntime(actor).activities.map(publicDowntimeActivity)))throw new Error('Shared downtime differs from the private dossier. Reload / resynchronize first.');
  const beforeTP=loaded.draft.amounts.tp,afterTP=beforeTP+dp;
  if(!Number.isSafeInteger(afterTP)||afterTP>1000000)throw new Error('The TP budget would exceed its limit.');
  return {actorUuid:actor.uuid,id,title:activity.title,activityRevision:activity.revision,dp,tp:dp,converted,available,beforeTP,afterTP,fingerprint:loaded.fingerprint};
}
export async function convertTrainingDP(actor,id,dp,expected=null) {
  requireGM();if(downtimeBusy.has(actor.uuid))throw new Error('Downtime operation already in progress.');
  downtimeBusy.add(actor.uuid);
  try {
    const plan=trainingConversionPlan(actor,id,dp);
    if(expected&&JSON.stringify(expected)!==JSON.stringify(plan))throw new Error('Training or rewards changed after confirmation. Reload and review again.');
    const source=privateDowntime(actor),after=dtCopy(source.activities),activity=after.find(item=>item.id===id);
    const event={kind:'trainingConversion',id:foundry.utils.randomID(32),at:new Date().toISOString(),dm:game.user.id,dp,tp:dp,baseTPBefore:plan.beforeTP,baseTPAfter:plan.afterTP};
    activity.history.push(event);activity.revision=foundry.utils.randomID(32);validatePrivateActivity(activity);
    const snapshot=readPlayerActor(actor,game.user,'gm'),loaded=readReadableDistribution(actor.system.background.biography,snapshot),nextDraft=dtCopy(loaded.draft);
    nextDraft.amounts.tp=plan.afterTP;nextDraft.downtime.activities=after.map(publicDowntimeActivity);
    const request=nextDraft.downtime.requests.find(item=>item.id===id);if(request)request.revision=activity.revision;
    const revision=foundry.utils.randomID(32),notes=writeReadableDistribution(actor.system.background.biography,nextDraft,snapshot,game.user,loaded.fingerprint,revision);
    const pending={fingerprint:loaded.fingerprint,revision,notes,before:source.activities,after,conversion:{...event,activityId:id,title:activity.title},expectedTP:plan.afterTP};
    checkNativeNotesSideEffects(actor);requireGM();
    if(!await actor.update({'flags.world.companionManager.active':true}))throw new Error('Could not lock Training conversion.');
    try{await saveDMDossier(actor,{downtimePending:pending});}catch(error){await actor.update({'flags.world.companionManager.active':false});throw error;}
    await resumeDowntimePublication(actor);return plan;
  } finally {downtimeBusy.delete(actor.uuid);}
}
export function downtimePlan(actor,draft) {
  requireGM();validateDowntime(draft);
  const source=privateDowntime(actor),before=source.activities,shared=draft.downtime??emptyDowntime();
  const canonical=before.map(publicDowntimeActivity);
  if(JSON.stringify(canonical)!==JSON.stringify(shared.activities))throw new Error('Shared downtime progress differs from the private DM dossier. Publish the current activity details before applying.');
  const snapshot=readPlayerActor(actor,game.user,'gm');validatePlayerDraft(draft,snapshot);
  const projected=projectedValues(draft,snapshot),after=dtCopy(before),changes=[],conversions=[];
  for(const request of shared.requests) {
    let activity=after.find(activity=>activity.id===request.id);
    if(activity&&activity.revision!==request.revision)throw new Error(`${request.title}: the activity changed since this request.`);
    if(!activity)activity={id:request.id,title:request.title,type:request.type,invested:0,required:null,showRequired:false,description:request.description,response:'',secret:'',status:'open',revision:foundry.utils.randomID(32),history:[]};
    if(activity.status!=='open')throw new Error(`${request.title}: this activity is closed.`);
    if(activity.required!==null&&activity.invested+request.dp>activity.required)throw new Error(`${request.title}: requested DP exceed the remaining requirement (${Math.max(0,activity.required-activity.invested)} DP). Adjust the request before applying.`);
    const original=dtCopy(activity);
    activity.title=request.title;activity.type=request.type;activity.description=request.description;activity.invested+=request.dp;
    activity.revision=foundry.utils.randomID(32);
    activity.history.push({at:new Date().toISOString(),dm:game.user.id,dp:request.dp,invested:activity.invested,description:request.description});
    const complete=activity.completeOnApply===true;
    if(complete){activity.status='complete';activity.completeOnApply=false;}
    if(request.trainingSkill) {
      const target=request.trainingSkill;
      const event={kind:'trainingConversion',id:foundry.utils.randomID(32),at:new Date().toISOString(),dm:game.user.id,dp:1,tp:1,baseTPBefore:draft.amounts.tp,baseTPAfter:draft.amounts.tp,skill:{id:target.itemId,name:target.name,rawBefore:target.start.raw,rawAfter:projected.get(target.itemId).raw}};
      activity.history.push(event);conversions.push({...event,title:activity.title,status:activity.status});
    }
    if(complete)activity.history.push({kind:'completion',at:new Date().toISOString(),dm:game.user.id,status:'complete',trigger:'progression'});
    validatePrivateActivity(activity);
    const index=after.findIndex(item=>item.id===activity.id);if(index<0)after.push(activity);else after[index]=activity;
    changes.push({id:activity.id,title:activity.title,dp:request.dp,before:original.invested,after:activity.invested});
  }
  return {before,after,changes,...(conversions.length?{conversions}:{})};
}
export async function applyDowntimePlan(actor,plan) {
  requireGM();const source=privateDowntime(actor);
  if(JSON.stringify(source.activities)===JSON.stringify(plan.after))return;
  if(JSON.stringify(source.activities)!==JSON.stringify(plan.before))throw new Error('Downtime progress changed outside the recorded transaction.');
  await saveDMDossier(actor,{downtime:{...source,activities:plan.after}});
}
export function verifyDowntimePlan(actor,plan) {
  if(JSON.stringify(privateDowntime(actor).activities)!==JSON.stringify(plan.after))throw new Error('Downtime progress could not be verified. Resume the update.');
}
export async function publishDowntimeActivity(actor,id,fields,expectedFingerprint) {
  requireGM();assertDowntimeIdle(actor);
  if(downtimeBusy.has(actor.uuid))throw new Error('Downtime update already in progress.');
  downtimeBusy.add(actor.uuid);
  try {
    const snapshot=readPlayerActor(actor,game.user,'gm'),loaded=readReadableDistribution(actor.system.background.biography,snapshot);
    if(loaded.fingerprint!==expectedFingerprint)throw new Error('Request notes changed. Reload before publishing downtime details.');
    const source=privateDowntime(actor),request=loaded.draft.downtime?.requests.find(request=>request.id===id),existing=source.activities.find(activity=>activity.id===id);
    if(!existing&&!request)throw new Error('Save the new activity request to the character notes first.');
    const base=existing??{id,title:request.title,type:request.type,invested:0,description:request.description,response:'',secret:'',required:null,showRequired:false,status:'open',history:[]};
    const activity={...dtCopy(base),...fields,id,invested:base.invested,history:base.history,revision:foundry.utils.randomID(32)};
    // A pending request remains applicable until its DP and skill changes finish.
    // Selecting Completed with that request schedules closure in its transaction.
    if(request&&activity.status==='complete'){activity.status='open';activity.completeOnApply=true;}
    else if(activity.status!=='open'&&activity.completeOnApply===true)activity.completeOnApply=false;
    if(existing?.invested>0&&activity.type!==existing.type)throw new Error('An invested activity cannot change type.');
    if(activity.required!==null&&activity.required<activity.invested)throw new Error('Required DP cannot be lower than invested DP.');
    validatePrivateActivity(activity);
    const after=dtCopy(source.activities),index=after.findIndex(item=>item.id===id);if(index<0)after.push(activity);else after[index]=activity;
    const nextDraft=dtCopy(loaded.draft);nextDraft.downtime??=emptyDowntime();nextDraft.downtime.activities=after.map(publicDowntimeActivity);
    const wish=nextDraft.downtime.requests.find(request=>request.id===id);
    if(wish){if(activity.status!=='open')throw new Error('Apply or remove the pending request before marking it Failed or Cancelled.');wish.revision=activity.revision;wish.type=activity.type;}
    const revision=foundry.utils.randomID(32),notes=writeReadableDistribution(actor.system.background.biography,nextDraft,snapshot,game.user,loaded.fingerprint,revision);
    const pending={fingerprint:loaded.fingerprint,revision,notes,before:source.activities,after};
    checkNativeNotesSideEffects(actor);
    if(!await actor.update({'flags.world.companionManager.active':true}))throw new Error('Could not lock the character during downtime publication.');
    try{await saveDMDossier(actor,{downtimePending:pending});}catch(error){await actor.update({'flags.world.companionManager.active':false});throw error;}
    await resumeDowntimePublication(actor);
    return activity;
  } finally {downtimeBusy.delete(actor.uuid);}
}
export async function resumeDowntimePublication(actor) {
  requireGM();const pending=dmDossiers.get(actor.uuid)?.data.downtimePending;
  if(!pending) {
    const data=dmDossiers.get(actor.uuid)?.data;
    if(!data||data.progression.active||data.characteristicPending||data.synchronizationPending||data.resynchronizationPending||!actor.flags?.world?.companionManager?.active)throw new Error('No completed downtime publication needs unlocking.');
    const loaded=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
    if(JSON.stringify(loaded.draft.downtime?.activities??[])!==JSON.stringify(privateDowntime(actor).activities.map(publicDowntimeActivity)))throw new Error('Shared downtime details differ from the DM dossier. Inspect the saved publication.');
    checkNativeNotesSideEffects(actor);if(!await actor.update({'flags.world.companionManager.active':false}))throw new Error('Could not release the update lock.');await saveCharacterReference(actor,'Recovered downtime publication');return;
  }
  const snapshot=readPlayerActor(actor,game.user,'gm'),loaded=readReadableDistribution(actor.system.background.biography,snapshot);
  if(loaded.fingerprint!==pending.fingerprint&&loaded.revision!==pending.revision)throw new Error('Shared notes changed during downtime publication. Inspect the DM dossier.');
  const source=privateDowntime(actor);
  if(JSON.stringify(source.activities)!==JSON.stringify(pending.before)&&JSON.stringify(source.activities)!==JSON.stringify(pending.after))throw new Error('Private activity details changed during publication.');
  if(loaded.revision!==pending.revision){checkNativeNotesSideEffects(actor);if(!await actor.update({'system.background.biography':pending.notes}))throw new Error('Downtime publication failed. Recover it in Summary.');}
  const published=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,game.user,'gm'));
  if(published.revision!==pending.revision||JSON.stringify(published.draft.downtime.activities)!==JSON.stringify(pending.after.map(publicDowntimeActivity)))throw new Error('Published downtime details could not be verified. Recover in Summary.');
  if(pending.conversion&&published.draft.amounts.tp!==pending.expectedTP)throw new Error('Training TP budget could not be verified. Recover in Summary.');
  await recordDMExchange(actor);await saveDMDossier(actor,{downtime:{...source,activities:pending.after},downtimePending:null});
  if(!await actor.update({'flags.world.companionManager.active':false}))throw new Error('Published details saved; reload to release the shared update lock.');
  await saveCharacterReference(actor,pending.conversion?'Training DP to TP conversion':'Downtime publication');
}

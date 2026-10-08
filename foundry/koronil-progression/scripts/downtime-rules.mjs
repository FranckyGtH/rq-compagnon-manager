export const downtimeTypes={'training':'Training','asset':'Acquire asset','project':'Long-term project','intrigue':'Intrigue / uncover a plot','recover':'Recover / indulge','amends':'Make amends','other':'Other'};
export const downtimePrompts={training:'Describe how you practice the selected skill. 1 DP funds one training; the DM applies it with this distribution.',asset:'Describe the spirit, pact, equipment or other asset you seek.',project:'Describe your goal and what this stage of the project should achieve.',intrigue:'Describe the information, person, faction or plot you want to investigate.',recover:'Describe the recovery or personal activity you undertake.',amends:'Describe whom you approach and how you intend to make amends.',other:'Describe your goal and the activity you undertake.'};
export const downtimeStatuses={open:'In progress',complete:'Completed',failed:'Failed',cancelled:'Cancelled'};
const dtInteger=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000;
const dtText=(value,max,empty=true)=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0);
const dtKeys=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join('|')===[...keys].sort().join('|');
export const emptyDowntime=()=>({activities:[],requests:[]});
export function convertedTrainingDP(activity) {
  if(!Array.isArray(activity.history))return activity.convertedDP??0;
  let total=0;const ids=new Set();
  for(const event of activity.history.filter(event=>event.kind==='trainingConversion')) {
    if(!dtKeys(event,['kind','id','at','dm','dp','tp','baseTPBefore','baseTPAfter',...(event.skill?['skill']:[])])||!dtText(event.id,100,false)||ids.has(event.id)||!dtText(event.at,100,false)||!dtText(event.dm,100,false)||!dtInteger(event.dp)||event.dp<1||event.tp!==event.dp||!dtInteger(event.baseTPBefore)||event.baseTPAfter!==event.baseTPBefore+(event.skill?0:event.tp)||!dtInteger(event.baseTPAfter)||event.skill&&(!dtKeys(event.skill,['id','name','rawBefore','rawAfter'])||event.dp!==1||!dtText(event.skill.id,100,false)||!dtText(event.skill.name,300,false)||!dtInteger(event.skill.rawBefore)||!dtInteger(event.skill.rawAfter)))throw new Error('Invalid Training conversion history.');
    ids.add(event.id);total+=event.dp;
  }
  if(!dtInteger(total)||total>activity.invested||total>0&&activity.type!=='training')throw new Error('Training conversion history exceeds invested DP.');
  return total;
}
export function publicDowntimeActivity(activity) {
  const converted=convertedTrainingDP(activity);
  return {id:activity.id,title:activity.title,type:activity.type,invested:activity.invested,required:activity.showRequired?activity.required:null,description:activity.description,response:activity.response,status:activity.status,revision:activity.revision,...(converted?{convertedDP:converted}:{})};
}
export function validateDowntime(draft) {
  const value=draft.downtime??emptyDowntime();
  if(!dtKeys(value,['activities','requests'])||!Array.isArray(value.activities)||!Array.isArray(value.requests)||value.activities.length>300||value.requests.length>300)throw new Error('Invalid downtime activity lists.');
  const known=new Map();
  for(const activity of value.activities) {
    if(!dtKeys(activity,['id','title','type','invested','required','description','response','status','revision',...(Object.hasOwn(activity,'convertedDP')?['convertedDP']:[])])||!dtText(activity.id,100,false)||known.has(activity.id)||!dtText(activity.title,150,false)||!Object.hasOwn(downtimeTypes,activity.type)||!dtInteger(activity.invested)||activity.required!==null&&!dtInteger(activity.required)||!dtText(activity.description,10000)||!dtText(activity.response,10000)||!Object.hasOwn(downtimeStatuses,activity.status)||!dtText(activity.revision,100,false)||Object.hasOwn(activity,'convertedDP')&&(!dtInteger(activity.convertedDP)||activity.convertedDP>activity.invested||activity.type!=='training'))throw new Error('Invalid or duplicate downtime activity.');
    known.set(activity.id,activity);
  }
  let used=0;const ids=new Set();
  for(const request of value.requests) {
    if(!dtKeys(request,['id','title','type','description','dp','revision',...(Object.hasOwn(request,'trainingSkill')?['trainingSkill']:[])])||!dtText(request.id,100,false)||ids.has(request.id)||!dtText(request.title,150,false)||!Object.hasOwn(downtimeTypes,request.type)||!dtText(request.description,10000)||!dtInteger(request.dp)||request.revision!==null&&!dtText(request.revision,100,false))throw new Error('Invalid or duplicate downtime request.');
    if(Object.hasOwn(request,'trainingSkill')) {
      const target=request.trainingSkill,start=target?.start;
      if(request.type!=='training'||request.dp!==1||!dtKeys(target,['itemId','name','start','fullBefore'])||!dtText(target.itemId,100,false)||!dtText(target.name,300,false)||!dtKeys(start,['raw','base','gained','tick'])||!dtInteger(start.raw)||![start.base,start.gained].every(Number.isSafeInteger)||start.raw!==start.base+start.gained||typeof start.tick!=='boolean'||target.fullBefore!==null&&!dtInteger(target.fullBefore))throw new Error('Invalid targeted Training request. One skill costs exactly 1 DP.');
    }
    ids.add(request.id);const activity=known.get(request.id);
    if(activity) {
      if(request.revision!==activity.revision)throw new Error(`${request.title}: downtime activity changed. Reload its current details.`);
      if(activity.status!=='open')throw new Error(`${request.title}: this activity is closed.`);
      if(activity.invested>0&&request.type!==activity.type)throw new Error(`${request.title}: the type cannot change after DP have been invested.`);
    } else if(request.revision!==null)throw new Error(`${request.title}: missing downtime activity reference.`);
    used+=request.dp;
  }
  if(!dtInteger(used))throw new Error('Downtime allocation is too large.');
  if(Number.isSafeInteger(draft.amounts?.dp)&&used>draft.amounts.dp)throw new Error(`DP budget exceeded: ${used} requested for ${draft.amounts.dp} available.`);
  return {used,remaining:draft.amounts?.dp===null?null:draft.amounts.dp-used};
}
export function validatePrivateActivity(activity) {
  if(!dtKeys(activity,['id','title','type','invested','required','showRequired','description','response','secret','status','revision','history',...(Object.hasOwn(activity,'completeOnApply')?['completeOnApply']:[])])||typeof activity.showRequired!=='boolean'||!dtText(activity.secret,10000)||!Array.isArray(activity.history)||activity.required!==null&&!dtInteger(activity.required)||Object.hasOwn(activity,'completeOnApply')&&(typeof activity.completeOnApply!=='boolean'||activity.completeOnApply&&activity.status!=='open'))throw new Error('Invalid private downtime activity.');
  validateDowntime({amounts:{dp:0},downtime:{activities:[publicDowntimeActivity(activity)],requests:[]}});
  return activity;
}
export function downtimeDP(draft){return (draft.downtime?.requests??[]).reduce((sum,request)=>sum+request.dp,0);}

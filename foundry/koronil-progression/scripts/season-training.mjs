export const seasons=['Sea','Fire','Earth','Dark','Storm','Sacred Time'];
export const trainingStats={strength:'STR',constitution:'CON',dexterity:'DEX',power:'POW',charisma:'CHA'};
export function defaultTraining(snapshot) {return {initialDex:null,speciesMaximum:String(snapshot?.species??'').trim().toLowerCase()==='human'?21:null};}
export function seasonalTP(draft) {return (draft.seasons??[]).filter(reward=>reward.choice==='tp').length*2;}
export function availableAmounts(draft) {return {...draft.amounts,tp:Number.isSafeInteger(draft.amounts.tp)?draft.amounts.tp+seasonalTP(draft):null};}
export function characteristicOptions(snapshot,training=defaultTraining(snapshot)) {
  return Object.entries(trainingStats).map(([key,label])=>{
    const stat=snapshot.characteristics?.[key],maximum=key==='dexterity'&&Number.isSafeInteger(training.initialDex)?Math.min(training.speciesMaximum,Math.floor(training.initialDex*1.5)):training.speciesMaximum;
    const reason=!stat||!Number.isSafeInteger(stat.value)?'Value unavailable':!Number.isSafeInteger(training.speciesMaximum)?'DM must set the species maximum':key==='dexterity'&&!Number.isSafeInteger(training.initialDex)?'DM must set initial DEX':stat.value>=maximum?'Training maximum reached':'';
    return {key,label,value:stat?.value,ticks:stat?.ticks??0,maximum,reason};
  });
}
export function validateSeasonTraining(draft,snapshot,{checkCurrent=true,requireChoices=false}={}) {
  const rewards=draft.seasons??[],training=draft.training??defaultTraining(snapshot);
  if(!Array.isArray(rewards)||rewards.length>100||Object.keys(training).sort().join('|')!=='initialDex|speciesMaximum'||[training.initialDex,training.speciesMaximum].some(value=>value!==null&&(!Number.isSafeInteger(value)||value<1||value>1000)))throw new Error('Invalid seasonal training settings.');
  const seen=new Set();
  for(const reward of rewards) {
    if(Object.keys(reward).sort().join('|')!=='choice|id|season|start|stat'||typeof reward.id!=='string'||!reward.id||reward.id.length>100||seen.has(reward.id)||!seasons.includes(reward.season)||!['pending','tp','stat'].includes(reward.choice))throw new Error('Invalid or duplicated seasonal reward.');
    seen.add(reward.id);
    if(reward.choice==='pending'&&requireChoices)throw new Error('Choose 2 TP or 1 Stat Tick for every seasonal reward before saving/applying.');
    if(reward.choice!=='stat') {if(reward.stat!==null||reward.start!==null)throw new Error('Unexpected characteristic in seasonal reward.');continue;}
    const start=reward.start;
    if(reward.stat===null||start===null)throw new Error(`Select a characteristic for the ${reward.season} training reward.`);
    if(!trainingStats[reward.stat]||!start||Object.keys(start).sort().join('|')!=='checked|ticks|value'||!Number.isSafeInteger(start.value)||!Number.isSafeInteger(start.ticks)||start.ticks<0||![true,false,null].includes(start.checked))throw new Error('Invalid characteristic starting values.');
    if(checkCurrent) {
      const option=characteristicOptions(snapshot,training).find(option=>option.key===reward.stat),current=snapshot.characteristics?.[reward.stat];
      if(option.reason)throw new Error(`${option.label}: ${option.reason}.`);
      if(current.value!==start.value||!snapshot.privateManager&&current.ticks!==start.ticks||current.checked!==start.checked)throw new Error(`${option.label}: characteristic or accumulated ticks changed. Choose the reward again.`);
    }
  }
  return rewards;
}
export function characteristicMarkdown(changes) {
  const groups=[];
  for(const change of changes) {
    const {key,before,after}=change,label=trainingStats[key]??key.toUpperCase();
    const added=after.ticks-before.ticks+(change.spent??0),increase=(after.value??before.value)-before.value;
    const previous=groups.findLast(group=>group.key===key);
    if(change.mode!=='force'&&previous&&!previous.forced&&previous.after.ticks===before.ticks&&previous.after.value===before.value) {
      previous.added+=added;previous.increase+=increase;previous.after={...after,value:after.value??before.value};
    } else groups.push({key,label,before,after:{...after,value:after.value??before.value},added,increase,forced:change.mode==='force'});
  }
  const ticks=count=>`${count} ${count===1?'tick':'ticks'}`;
  return groups.map(group=>{
    const {label,before,after,added,increase,forced}=group;
    if(forced)return `- ${label} (${ticks(before.ticks)}) → ${label} (${ticks(after.ticks)}) (DM adjustment).`;
    return `- ${added?'Tick ':''}${label} (${ticks(before.ticks)})${added?` + ${added} = ${label} (${ticks(before.ticks+added)})`:''}${increase?` = +${increase} ${label} (${ticks(after.ticks)})`:''}.`;
  });
}
export function seasonalCharacteristicChanges(draft,snapshot) {
  const increments={};for(const reward of draft.seasons??[])if(reward.choice==='stat'&&reward.stat)increments[reward.stat]=(increments[reward.stat]??0)+1;
  return Object.entries(increments).map(([key,count])=>{const before={...snapshot.characteristics[key]};return {key,before,after:{...before,ticks:before.ticks+count},spent:0};});
}
// The report covers characteristic operations since the preceding distribution.
// In applied mode it also includes operations performed after that distribution.
export function managerProgressionMarkdown(draft,snapshot,store,applied=false,downtime=null) {
  const history=store?.history??[],tx=history.at(-1);
  if(applied&&!tx)return '';
  const boundary=(applied?history.at(-2):tx)?.completedAt??'';
  const events=(store?.characteristicHistory??[]).filter(event=>!boundary||event.at>boundary).map(event=>({at:event.at,changes:event.changes.map(change=>({...change,mode:event.mode}))}));
  if(applied)events.push({at:tx.completedAt,changes:tx.plan.statChanges??seasonalCharacteristicChanges(tx.plan.draft,snapshot)});
  events.sort((a,b)=>a.at.localeCompare(b.at));
  const changes=events.flatMap(event=>event.changes);
  if(!applied)changes.push(...seasonalCharacteristicChanges(draft,snapshot));
  const reportDraft=applied?{...tx.plan.draft,downtime:{...tx.plan.draft.downtime,activities:tx.plan.downtimeChanges?.after??tx.plan.draft.downtime?.activities??[]}}:draft;
  const conversions=(downtime?.activities??[]).flatMap(activity=>activity.history.filter(event=>event.kind==='trainingConversion'&&(!boundary||event.at>boundary)).map(event=>({...event,title:activity.title,status:activity.status}))).sort((a,b)=>a.at.localeCompare(b.at));
  return progressionMarkdown(reportDraft,snapshot,changes,conversions);
}
export function progressionMarkdown(draft,snapshot,characteristicChanges=null,conversions=[]) {
  const entries=draft.entries??[],names=entry=>{
    const row=snapshot.rows.find(row=>row.id===entry.itemId);
    const kind={form:'Form',power:'Power',element:'Element',condition:'Condition',technique:'Technique'}[row?.category];
    const name=entry.type==='rune'&&kind?`${kind}: ${entry.name}`:entry.name;
    return name.replace(/([\\`*_\[\]])/g,'\\$1').replace(/[\r\n]/g,' ');
  };
  const xp=entries.filter(entry=>entry.xp),tp=entries.filter(entry=>entry.tp),lines=[];
  if(xp.length) {
    const tick=xp.filter(entry=>entry.start.tick),noTick=xp.filter(entry=>!entry.start.tick);
    lines.push(`- ${xp.reduce((sum,entry)=>sum+entry.xp,0)} XPs: ${tick.length?`(Tick): ${tick.map(names).join(', ')}.`:''}${noTick.length?`${tick.length?' ':''}XPs (without Tick): ${noTick.map(names).join(', ')}.`:''}`);
  }
  if(tp.length)lines.push(`- ${tp.reduce((sum,entry)=>sum+entry.tp,0)} TPs: ${tp.map(names).join(', ')}.`);
  for(const reward of draft.seasons??[])lines.push(`- End of ${reward.season}${reward.season==='Sacred Time'?'':' Season'} Training: ${reward.choice==='tp'?'2 TPs':reward.choice==='stat'?`1 Stat Tick (${trainingStats[reward.stat]})`:'2 TPs or 1 Stat Tick (pending)'}.`);
  lines.push(...characteristicMarkdown(characteristicChanges??seasonalCharacteristicChanges(draft,snapshot)));
  for(const conversion of conversions)lines.push(`- Training: ${conversion.dp} DPs → ${conversion.tp} TPs${conversion.skill?` (applied to ${conversion.skill.name.replace(/([\\`*_\[\]])/g,'\\$1').replace(/[\r\n]/g,' ')})`:''}: ${conversion.title.replace(/([\\`*_\[\]])/g,'\\$1').replace(/[\r\n]/g,' ')} [${{open:'In progress',complete:'Completed',failed:'Failed',cancelled:'Cancelled'}[conversion.status]}].`);
  for(const activity of draft.downtime?.requests??[]) {
    const status=draft.downtime.activities?.find(item=>item.id===activity.id)?.status??'open';
    const label={open:'In progress',complete:'Completed',failed:'Failed',cancelled:'Cancelled'}[status]??status;
    lines.push(`- ${activity.dp} DPs: ${activity.title.replace(/([\\`*_\[\]])/g,'\\$1').replace(/[\r\n]/g,' ')} [${label}]${activity.trainingSkill?` — train ${activity.trainingSkill.name.replace(/([\\`*_\[\]])/g,'\\$1').replace(/[\r\n]/g,' ')}`:''}${activity.dp?'':' (details update)'}.`);
  }
  return lines.join('\n');
}

// Remove only paragraphs produced by this application's export logger. Keep
// unrelated biography bytes intact, including all progression marker sections.
export function appendExportHistory(html,entry) {
  const heading='Compagnon Manager — Export history';
  const matches=[...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].filter(match=>{
    const doc=new DOMParser().parseFromString(match[0],'text/html'),strong=doc.querySelector('strong')?.textContent.trim(),text=doc.body.textContent;
    return ['Before application','After application'].includes(strong)&&text.includes('Export requested (UTC):')&&text.includes('File: fvtt-Actor-')&&text.includes('.json');
  });
  let result=html;
  for(const match of matches.slice(0,Math.max(0,matches.length-4)).reverse())result=result.slice(0,match.index)+result.slice(match.index+match[0].length);
  const hasHeading=[...new DOMParser().parseFromString(result,'text/html').querySelectorAll('h3')].some(node=>node.textContent.trim()===heading);
  return result+'\n'+(hasHeading?'':`<h3>${heading}</h3>`)+entry;
}

import { publishDMExchange } from './dm-synchronization.mjs';
import { escapeHTML } from './core.mjs';
import { marker, ranges, readDistribution, parseQuantity, canSaveNotes, checkNativeNotesSideEffects, validateDraft } from './distribution.mjs';
import { readPlayerActor, projectedValues, validatePlayerDraft } from './player-rules.mjs';
import { availableAmounts, defaultTraining, validateSeasonTraining } from './season-training.mjs';
import { downtimeTypes, downtimeStatuses, validateDowntime, emptyDowntime } from './downtime-rules.mjs';

const humanKinds=['POINTS','WISHES'];
const humanMeta=['Format','Character reference','Revision','Saved by','Saved at','Origin'];
const requestHeaders=['Entry','Raw before','Full before','XP','TP','Direction','New raw','New full','Reference'];
const referenceHeaders=['Reference','Type','Base before','Acquired before','Exp. Tick','Opposed reference'];
const seasonHeaders=['Reward reference','Season','Choice','Characteristic','Value before','Ticks before','Native tick before'];
const activityHeaders=['Activity reference','Title','Type','DP invested','DP required','Description','DM response','Status','Revision'];
const trainingActivityHeaders=[...activityHeaders,'DP converted to TP'];
const activityRequestHeaders=['Activity reference','Title','Type','Description','DP requested','Starting revision'];
const targetedRequestHeaders=[...activityRequestHeaders,'Training skill reference','Training skill','Raw before','Base before','Acquired before','Exp. Tick','Full before'];
function activityRequestRows(table){return tableData(table,table.rows[0]?.cells.length===targetedRequestHeaders.length?targetedRequestHeaders:activityRequestHeaders);}
const safePercent=value=>value===null||value===undefined?'—':`${value} %`;
const makeTable=(headers,rows)=>`<table><thead><tr>${headers.map(value=>`<th>${escapeHTML(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${escapeHTML(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
function tableData(table,headers) {
  const rows=[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent.trim()));
  if(rows[0]?.join('|')!==headers.join('|')||rows.slice(1).some(row=>row.length!==headers.length)||rows.length>1001)throw new Error('Unrecognized note table. Existing notes will be preserved.');
  return rows.slice(1);
}
function meta(doc) {
  const tables=[...doc.body.querySelectorAll('table')];
  const rows=tableData(tables[0]??{rows:[]},['Field','Value']);
  if(rows.map(row=>row[0]).join('|')!==humanMeta.join('|'))throw new Error('Invalid note metadata.');
  const values=rows.map(row=>row[1]);
  if(!['2','3','4','5','6'].includes(values[0])||values.some(value=>!value||value.length>300)||!Number.isFinite(Date.parse(values[4]))||!['Player declaration','GM declaration'].includes(values[5]))throw new Error('Unknown or invalid note format.');
  return {tables,values};
}
function percentCell(value,{nullable=false}={}) {
  if(nullable&&value==='—')return null;
  if(!/^-?\d+ %$/.test(value)||!Number.isSafeInteger(Number(value.slice(0,-2))))throw new Error('Invalid percentage in notes.');
  return Number(value.slice(0,-2));
}
export function readReadableDistribution(html,snapshot) {
  if(typeof html!=='string')throw new Error('The notes field is unavailable.');
  const blocks=ranges(html);
  const fingerprint=JSON.stringify(humanKinds.map(kind=>blocks[kind]?.html??null));
  if(humanKinds.every(kind=>!blocks[kind]))return {draft:{amounts:{xp:0,tp:0,dp:0},entries:[]},present:false,fingerprint};
  if(humanKinds.some(kind=>!blocks[kind]))throw new Error('Points and requests sections must be present together.');
  const docs=humanKinds.map(kind=>new DOMParser().parseFromString(blocks[kind].inner,'text/html'));
  if(docs.every(doc=>doc.body.querySelector('pre')))return readDistribution(html,snapshot);
  if(docs.some(doc=>doc.body.querySelector('pre,script,img,iframe')))throw new Error('Mixed or damaged note format.');
  const [points,wishes]=docs.map(meta);
  if(points.values[0]==='6'||wishes.values[0]==='6')return readExchangeNotes(html,snapshot,blocks,docs,points,wishes,fingerprint);
  const noteFormat=Number(points.values[0]);
  if(points.tables.length!==(noteFormat===5?5:noteFormat===4?4:2)||wishes.tables.length!==(noteFormat===5?4:3)||points.values.join('|')!==wishes.values.join('|')||points.values[1]!==snapshot.uuid)throw new Error('Inconsistent note sections, character or revision.');
  const budgetRows=tableData(points.tables[1],['Resource',noteFormat>=4?'Base assigned':'Available','Allocated','Remaining']);
  if(budgetRows.map(row=>row[0]).join('|')!=='XP|TP|DP')throw new Error('Invalid resource table.');
  const amounts=Object.fromEntries(budgetRows.map(row=>[row[0].toLowerCase(),parseQuantity(row[1])]));
  const requests=tableData(wishes.tables[1],requestHeaders),references=tableData(wishes.tables[2],referenceHeaders);
  if(requests.length!==references.length)throw new Error('Missing starting values.');
  const entries=[],usedRefs=new Set(),savedRows=[],savedPairs=[];
  for(const request of requests) {
    const [name,rawBefore,fullBefore,xp,tp,direction,newRaw,newFull,id]=request;
    const matches=references.filter(row=>row[0]===id);
    if(!id||id.length>300||!name||name.length>300||usedRefs.has(id)||matches.length!==1)throw new Error('Missing or duplicated item reference.');
    usedRefs.add(id);
    const [,type,base,gained,tick,opposed]=matches[0];
    if(!['skill','passion','rune'].includes(type)||!['Checked','Unchecked'].includes(tick)||!['Increase','Decrease'].includes(direction))throw new Error('Invalid request data.');
    const entry={itemId:id,name,type,xp:parseQuantity(xp),tp:parseQuantity(tp),direction:direction==='Increase'?'add':'subtract',start:{raw:percentCell(rawBefore),base:percentCell(base,{nullable:true}),gained:percentCell(gained,{nullable:true}),tick:tick==='Checked'}};
    if(entry.xp>1||entry.tp>1||type!=='skill'&&entry.tp||type==='skill'&&(entry.direction!=='add'||entry.start.base===null||entry.start.gained===null||entry.start.raw!==entry.start.base+entry.start.gained)||type!=='skill'&&(entry.start.base!==null||entry.start.gained!==null))throw new Error('Invalid allocation or starting values.');
    const current=snapshot.rows.find(row=>row.id===id);
    if(!current||current.type!==type)throw new Error(`${name}: item missing or changed.`);
    entries.push(entry);
    savedRows.push({...current,...entry.start,effective:percentCell(fullBefore,{nullable:true})});
    if(opposed!=='—') {
      if(type!=='rune'||!references.some(row=>row[0]===opposed&&row[5]===id)||!(snapshot.pairs??[]).some(pair=>pair.includes(id)&&pair.includes(opposed)))throw new Error('Opposed rune references have changed. Ask the GM to check the sheet.');
      if(!savedPairs.some(pair=>pair.includes(id)))savedPairs.push([id,opposed]);
    }
    percentCell(newRaw);percentCell(newFull,{nullable:true});
  }
  const draft={amounts,entries};
  if(noteFormat>=4) {
    draft.seasons=tableData(points.tables[2],seasonHeaders).map(([id,season,choice,stat,value,ticks,checked])=>{
      if(!['Pending','2 TP','1 Stat Tick'].includes(choice)||!['Checked','Unchecked','—'].includes(checked))throw new Error('Invalid seasonal choice.');
      if(choice!=='1 Stat Tick'&&[stat,value,ticks,checked].some(value=>value!=='—'))throw new Error('Unexpected characteristic values in seasonal notes.');
      return {id,season,choice:choice==='2 TP'?'tp':choice==='1 Stat Tick'?'stat':'pending',stat:stat==='—'?null:stat,start:choice==='1 Stat Tick'?{value:parseQuantity(value),ticks:parseQuantity(ticks),checked:checked==='—'?null:checked==='Checked'}:null};
    });
    const settings=tableData(points.tables[3],['Setting','Value']);
    if(settings.map(row=>row[0]).join('|')!=='Initial DEX|Species maximum')throw new Error('Invalid training settings.');
    draft.training={initialDex:settings[0][1]==='—'?null:parseQuantity(settings[0][1]),speciesMaximum:settings[1][1]==='—'?null:parseQuantity(settings[1][1])};
    validateSeasonTraining(draft,snapshot,{checkCurrent:false});
  }
  if(noteFormat===5) {
    const decode=(map,label)=>Object.keys(map).find(key=>map[key]===label)??'';
    const headers=points.tables[4].rows[0]?.cells.length===trainingActivityHeaders.length?trainingActivityHeaders:activityHeaders;
    draft.downtime={activities:tableData(points.tables[4],headers).map(([id,title,type,invested,required,description,response,status,revision,converted])=>({id,title,type:decode(downtimeTypes,type),invested:parseQuantity(invested),required:required==='Hidden / not set'?null:parseQuantity(required),description,response,status:decode(downtimeStatuses,status),revision,...(converted!==undefined&&parseQuantity(converted)>0?{convertedDP:parseQuantity(converted)}:{})})),requests:activityRequestRows(wishes.tables[3]).map(([id,title,type,description,dp,revision,...target])=>{
      const request={id,title,type:decode(downtimeTypes,type),description,dp:parseQuantity(dp),revision:revision==='New activity'?null:revision};
      if(target.length&&target[0]!=='—') {
        if(!['Checked','Unchecked'].includes(target[5]))throw new Error('Invalid Training experience reference.');
        request.trainingSkill={itemId:target[0],name:target[1],start:{raw:percentCell(target[2]),base:percentCell(target[3]),gained:percentCell(target[4]),tick:target[5]==='Checked'},fullBefore:percentCell(target[6],{nullable:true})};
      } else if(target.some(cell=>cell!=='—'))throw new Error('Orphan Training references in notes.');
      return request;
    })};
    validateDowntime(draft);
    for(const request of draft.downtime.requests.filter(request=>request.trainingSkill)) {
      const target=request.trainingSkill,current=snapshot.rows.find(row=>row.id===target.itemId);
      if(!current||current.type!=='skill')throw new Error(`${target.name}: Training skill missing or replaced.`);
      const saved=savedRows.find(row=>row.id===target.itemId);
      if(saved&&saved.effective!==target.fullBefore)throw new Error('Training and XP/TP full starting values differ.');
      if(!saved)savedRows.push({...current,...target.start,effective:target.fullBefore});
    }
    for(const style of snapshot.styles??[])if(draft.downtime.requests.some(request=>request.trainingSkill?.itemId===style.id))for(const id of style.members)if(!savedRows.some(row=>row.id===id))savedRows.push(snapshot.rows.find(row=>row.id===id));
  }
  validateDraft({amounts:availableAmounts(draft),entries:entries.filter(entry=>entry.xp||entry.tp)},snapshot,{checkCurrent:false});
  const projected=projectedValues(draft,{...snapshot,rows:savedRows,pairs:savedPairs,styles:Number(points.values[0])>=3?snapshot.styles:[]},{checkCurrent:false});
  requests.forEach(row=>{
    const value=projected.get(row[8]);
    if(value.raw!==percentCell(row[6])||value.full!==percentCell(row[7],{nullable:true}))throw new Error('The projected values in the notes do not match the allocations.');
  });
  const used={xp:entries.reduce((sum,e)=>sum+e.xp,0),tp:entries.reduce((sum,e)=>sum+e.tp,0),dp:validateDowntime(draft).used};
  budgetRows.forEach(row=>{const k=row[0].toLowerCase();if(parseQuantity(row[2])!==used[k]||parseQuantity(row[3])!==availableAmounts(draft)[k]-used[k])throw new Error('Resource totals in the notes do not match the requests.');});
  return {draft,present:true,fingerprint,revision:points.values[2],updatedAt:points.values[4],origin:points.values[5],format:Number(points.values[0])};
}
export function submittedPlayerDraft(draft,snapshot) {
  const wanted=new Set(draft.entries.filter(entry=>entry.xp||entry.tp).map(entry=>entry.itemId));
  for(const pair of snapshot.pairs??[])if(pair.some(id=>wanted.has(id)))pair.forEach(id=>wanted.add(id));
  for(const style of snapshot.styles??[])if(wanted.has(style.id))style.members.forEach(id=>wanted.add(id));
  const entries=[...wanted].map(id=>{
    const entry=draft.entries.find(entry=>entry.itemId===id);
    if(entry)return entry;
    const row=snapshot.rows.find(row=>row.id===id);
    return {itemId:id,name:row.name,type:row.type,xp:0,tp:0,direction:'add',start:{raw:row.raw,base:row.base,gained:row.gained,tick:row.tick}};
  });
  const result=JSON.parse(JSON.stringify({amounts:draft.amounts,entries,...(draft.seasons?{seasons:draft.seasons,training:draft.training??defaultTraining(snapshot)}:{}),...(draft.downtime?{downtime:draft.downtime}:{})}));
  if(snapshot.privateManager)result.downtime??=emptyDowntime();
  if(result.downtime){result.seasons??=[];result.training??=defaultTraining(snapshot);}
  if(snapshot.privateManager)for(const reward of result.seasons??[])if(reward.start)reward.start.ticks=0;
  return result;
}
export function writeReadableDistribution(html,draft,snapshot,user,fingerprint,revision) {
  if(snapshot.privateManager){draft=JSON.parse(JSON.stringify(draft));for(const reward of draft.seasons??[])if(reward.start)reward.start.ticks=0;}
  const loaded=readReadableDistribution(html,snapshot);
  if(snapshot.privateManager){draft=JSON.parse(JSON.stringify(draft));draft.downtime??=emptyDowntime();draft.seasons??=[];draft.training??=defaultTraining(snapshot);}
  if(loaded.fingerprint!==fingerprint)throw new Error('The request or points were changed elsewhere. Reload notes; your draft is still displayed.');
  if(!user.isGM&&(loaded.origin!=='GM declaration'||['xp','tp','dp'].some(k=>draft.amounts[k]!==loaded.draft.amounts[k])))throw new Error('Only the DM can assign XP, TP and DP budgets. Ask the DM to assign points first.');
  if(!user.isGM) {
    if(JSON.stringify(draft.downtime?.activities??[])!==JSON.stringify(loaded.draft.downtime?.activities??[]))throw new Error('Only the DM can change invested DP, required DP, results or activity status.');
    const rewards=value=>JSON.stringify((value.seasons??[]).map(reward=>[reward.id,reward.season]));
    if(rewards(draft)!==rewards(loaded.draft)||JSON.stringify(draft.training??defaultTraining(snapshot))!==JSON.stringify(loaded.draft.training??defaultTraining(snapshot)))throw new Error('Only the DM can assign seasonal rewards or change training settings.');
    validateSeasonTraining(draft,snapshot,{requireChoices:true});
  }
  const balances=validatePlayerDraft(draft,snapshot),projected=projectedValues(draft,snapshot);
  if(draft.downtime){draft.seasons??=[];draft.training??=defaultTraining(snapshot);}
  const format=draft.downtime?'5':draft.seasons?'4':'3';
  const metadata=makeTable(['Field','Value'],humanMeta.map((field,index)=>[field,[format,snapshot.uuid,revision,user.id,new Date().toISOString(),'GM declaration'][index]]));
  const budgetTable=makeTable(['Resource',Number(format)>=4?'Base assigned':'Available','Allocated','Remaining'],['xp','tp','dp'].map(k=>[k.toUpperCase(),draft.amounts[k],balances.used[k],balances.remaining[k]]));
  const requests=makeTable(requestHeaders,draft.entries.map(entry=>{
    const row=snapshot.rows.find(row=>row.id===entry.itemId),next=projected.get(entry.itemId);
    return [entry.name,safePercent(entry.start.raw),safePercent(row.effective),entry.xp,entry.tp,entry.direction==='add'?'Increase':'Decrease',safePercent(next.raw),safePercent(next.full),entry.itemId];
  }));
  const references=makeTable(referenceHeaders,draft.entries.map(entry=>[entry.itemId,entry.type,safePercent(entry.start.base),safePercent(entry.start.gained),entry.start.tick?'Checked':'Unchecked',(snapshot.pairs??[]).find(pair=>pair.includes(entry.itemId))?.find(id=>id!==entry.itemId)??'—']));
  const training=draft.training??defaultTraining(snapshot);
  const seasonTable=draft.seasons?`<h4>End of season training — 2 TP or 1 Stat Tick per reward</h4>${makeTable(seasonHeaders,draft.seasons.map(reward=>[reward.id,reward.season,reward.choice==='tp'?'2 TP':reward.choice==='stat'?'1 Stat Tick':'Pending',reward.stat??'—',reward.start?.value??'—',reward.start?.ticks??'—',reward.start?.checked===true?'Checked':reward.start?.checked===false?'Unchecked':'—']))}<p>Season TP bonuses are added to the base TP budget shown above when calculating remaining points.</p>${makeTable(['Setting','Value'],[['Initial DEX',training.initialDex??'—'],['Species maximum',training.speciesMaximum??'—']])}`:'';
  const downtime=draft.downtime??emptyDowntime();
  const showConversions=downtime.activities.some(activity=>activity.convertedDP>0);
  const activityTable=draft.downtime?`<h3>Downtime activities — confirmed progress</h3>${makeTable(showConversions?trainingActivityHeaders:activityHeaders,downtime.activities.map(activity=>[activity.id,activity.title,downtimeTypes[activity.type],activity.invested,activity.required??'Hidden / not set',activity.description,activity.response,downtimeStatuses[activity.status],activity.revision,...(showConversions?[activity.convertedDP??0]:[])]))}`:'';
  const targeted=downtime.requests.some(request=>request.trainingSkill);
  const activityRequests=draft.downtime?`<h3>Downtime requests — pending DM approval</h3>${makeTable(targeted?targetedRequestHeaders:activityRequestHeaders,downtime.requests.map(request=>[request.id,request.title,downtimeTypes[request.type],request.description,request.dp,request.revision??'New activity',...(targeted?(request.trainingSkill?[request.trainingSkill.itemId,request.trainingSkill.name,safePercent(request.trainingSkill.start.raw),safePercent(request.trainingSkill.start.base),safePercent(request.trainingSkill.start.gained),request.trainingSkill.start.tick?'Checked':'Unchecked',safePercent(request.trainingSkill.fullBefore)]:Array(7).fill('—')):[])]))}`:'';
  const contents={POINTS:`<h3>Points to distribute</h3>${metadata}${budgetTable}${seasonTable}${activityTable}`,WISHES:`<h3>Progression requests</h3><p>Pending GM approval. These values have not been applied to the character.</p>${metadata}${requests}<h4>References and starting values</h4>${references}${activityRequests}`};
  const replacement=kind=>`<p>${marker(kind,'BEGIN')}</p>${contents[kind]}<p>${marker(kind,'END')}</p>`;
  const blocks=ranges(html);
  if(!loaded.present){const generated=html+'\n'+humanKinds.map(replacement).join('\n');return snapshot.privateManager?writeExchangeNotes(generated,html,snapshot,user,loaded,revision):generated;}
  let result=html;
  for(const kind of [...humanKinds].sort((a,b)=>blocks[b].start-blocks[a].start))result=result.slice(0,blocks[kind].start)+replacement(kind)+result.slice(blocks[kind].end);
  return snapshot.privateManager?writeExchangeNotes(result,html,snapshot,user,loaded,revision):result;
}
export async function saveReadableDistribution(actor,user,role,draft,fingerprint) {
  if(!canSaveNotes(actor,user,role))throw new Error('This account cannot save character notes. The draft remains unsaved.');
  checkNativeNotesSideEffects(actor);
  if(actor.flags?.world?.companionManager?.active)throw new Error('An update is in progress or needs recovery. The DM must finish it before editing request notes.');
  const snapshot=readPlayerActor(actor,user,role),submitted=submittedPlayerDraft(draft,snapshot);
  const revision=globalThis.crypto?.randomUUID?.()??globalThis.foundry.utils.randomID(32);
  const author={id:user.id,isGM:role==='gm'&&user.isGM===true};
  const next=writeReadableDistribution(actor.system.background.biography,submitted,snapshot,author,fingerprint,revision);
  const updated=author.isGM&&snapshot.privateManager?await publishDMExchange(actor,next,fingerprint):await actor.update({'system.background.biography':next});
  if(!updated)throw new Error('Save refused. The draft remains unsaved.');
  const saved=readReadableDistribution(actor.system.background.biography,readPlayerActor(actor,user,role));
  const signature=value=>JSON.stringify([value.amounts.xp,value.amounts.tp,value.amounts.dp,value.entries.map(entry=>[entry.itemId,entry.name,entry.type,entry.xp,entry.tp,entry.direction,entry.start.raw,entry.start.base,entry.start.gained,entry.start.tick]),value.seasons??[],value.training??null,value.downtime??null]);
  if(saved.revision!==revision||signature(saved.draft)!==signature(submitted))throw new Error('Save could not be verified. Reload notes to check their state.');
  return saved;
}

const exchangeSeasonHeaders=['Reward reference','Choice','Characteristic','Value before','Ticks before','Native tick before'];
const exchangeLinkHeaders=['DM revision'];
function exchangeBlock(kind,inner){return '<p>'+marker(kind,'BEGIN')+'</p>'+inner+'<p>'+marker(kind,'END')+'</p>';}
function replaceExchangeBlocks(html,contents){const blocks=ranges(html);let result=html;for(const kind of Object.keys(contents).sort((a,b)=>blocks[b].start-blocks[a].start))result=result.slice(0,blocks[kind].start)+exchangeBlock(kind,contents[kind])+result.slice(blocks[kind].end);return result;}
function readExchangeNotes(html,snapshot,blocks,docs,points,wishes,fingerprint) {
  if(points.values[0]!=='6'||wishes.values[0]!=='6'||points.tables.length!==5||wishes.tables.length!==6||points.values[1]!==snapshot.uuid||wishes.values[1]!==snapshot.uuid||points.values[5]!=='GM declaration')throw new Error('Invalid DM / PC exchange format.');
  const link=tableData(wishes.tables[5],exchangeLinkHeaders);
  if(link.length!==1||link[0][0]!==points.values[2])throw new Error('This request refers to an obsolete DM synchronization. Reload the notes.');
  const assigned=tableData(points.tables[2],seasonHeaders),choices=tableData(wishes.tables[4],exchangeSeasonHeaders);
  if(choices.length!==assigned.length||new Set(choices.map(row=>row[0])).size!==choices.length||assigned.some(row=>row[2]!=='Pending'||row.slice(3).some(cell=>cell!=='—')))throw new Error('Invalid seasonal assignments / choices.');
  const merged=assigned.map(row=>{const choice=choices.find(choice=>choice[0]===row[0]);if(!choice)throw new Error('Missing seasonal choice.');return [row[0],row[1],...choice.slice(1)];});
  points.tables[2].outerHTML=makeTable(seasonHeaders,merged);
  const budgets=tableData(points.tables[1],['Resource','Base assigned']),entries=tableData(wishes.tables[1],requestHeaders),requests=activityRequestRows(wishes.tables[3]);
  if(budgets.map(row=>row[0]).join('|')!=='XP|TP|DP')throw new Error('Invalid assigned budgets.');
  const used={xp:entries.reduce((n,r)=>n+parseQuantity(r[3]),0),tp:entries.reduce((n,r)=>n+parseQuantity(r[4]),0),dp:requests.reduce((n,r)=>n+parseQuantity(r[4]),0)};
  const bonus=merged.filter(row=>row[2]==='2 TP').length*2;
  points.tables[1].outerHTML=makeTable(['Resource','Base assigned','Allocated','Remaining'],budgets.map(([label,amount])=>{const key=label.toLowerCase(),base=parseQuantity(amount),remaining=base+(key==='tp'?bonus:0)-used[key];if(remaining<0)throw new Error(label+' budget exceeded.');return [label,base,used[key],remaining];}));
  wishes.tables[4].remove();wishes.tables[5].remove();
  const legacyMeta=makeTable(['Field','Value'],humanMeta.map((field,i)=>[field,i===0?'5':points.values[i]]));
  points.tables[0].outerHTML=legacyMeta;wishes.tables[0].outerHTML=legacyMeta;
  const normalized=replaceExchangeBlocks(html,{POINTS:docs[0].body.innerHTML,WISHES:docs[1].body.innerHTML});
  const loaded=readReadableDistribution(normalized,snapshot);
  return {...loaded,format:6,fingerprint,revision:wishes.values[2],updatedAt:wishes.values[4],sharedRevision:points.values[2],requestAuthor:wishes.values[3]};
}
function writeExchangeNotes(generated,original,snapshot,user,loaded,revision) {
  if(!user.isGM&&loaded.format!==6)throw new Error('The DM must save / synchronize this character with the new Manager before you can submit a request.');
  const blocks=ranges(generated),docs=humanKinds.map(kind=>new DOMParser().parseFromString(blocks[kind].inner,'text/html')),[points,wishes]=docs.map(meta);
  const seasonRows=tableData(points.tables[2],seasonHeaders),budgets=tableData(points.tables[1],['Resource','Base assigned','Allocated','Remaining']);
  points.tables[1].outerHTML=makeTable(['Resource','Base assigned'],budgets.map(row=>row.slice(0,2)));
  points.tables[2].outerHTML=makeTable(seasonHeaders,seasonRows.map(row=>[row[0],row[1],'Pending','—','—','—','—']));
  for(const part of [points,wishes])part.tables[0].rows[1].cells[1].textContent='6';
  const help=docs[0].body.querySelector('p');if(help)help.textContent='Season bonuses and remaining points are calculated from saved requests in the Manager.';
  if(!user.isGM)wishes.tables[0].rows[6].cells[1].textContent='Player declaration';
  docs[1].body.insertAdjacentHTML('beforeend','<h4>Season choices — pending DM approval</h4>'+makeTable(exchangeSeasonHeaders,seasonRows.map(row=>[row[0],...row.slice(2)]))+makeTable(exchangeLinkHeaders,[[user.isGM?revision:loaded.sharedRevision]]));
  return replaceExchangeBlocks(loaded.present?original:generated,{...(user.isGM?{POINTS:docs[0].body.innerHTML}:{}),WISHES:docs[1].body.innerHTML});
}

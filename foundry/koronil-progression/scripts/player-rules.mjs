import { unitGains, validateDraft, baseline } from './distribution.mjs';
import { readActor } from './core.mjs';
import { availableAmounts, validateSeasonTraining } from './season-training.mjs';
import { managerState } from './manager-state.mjs';
import { validateDowntime } from './downtime-rules.mjs';

// Workbook Koronil_Skills_Management, Tab_Source table AN41:AO65.
export const combatPacks = Object.freeze({
  Berserker:['2H Swords (Greatsword)','2H Axes (Great Axe)','1H Swords (Broadsword)','1H Axes (Battle Axe)','Shields (Medium)'],
  Fyrdman:['2H Spears (Shortspear)','1H Axes (Small Axe)','Shields (Small)','Slings (Sling)'],
  'Horse Thegn':['1H Spears (Shortspear)','1H Swords (Shortsword)','Bows (Horse Bow)','Shields (Medium)'],
  Slinger:['Slings (Sling)','1H Axes (Handaxe)','Shields (Medium)'],
  'Weapon Thegn':['1H Swords (Broadsword)','1H Axes (Battle Axe)','Shields (Large)','Shields (Medium)','Bows (Self Bow)'],
  'Wolf Hunter':['Bows (Longbow)','1H Axes (Battle Axe)','1H Daggers (Dagger)']
});
function identifyCombatStyles(snapshot) {
  const key=name=>name.trim().toLowerCase();
  snapshot.styles=[];
  for(const style of snapshot.rows.filter(row=>row.type==='skill'&&/^Combat Style \(.+\)$/i.test(row.name))) {
    const pack=style.name.match(/^Combat Style \((.+)\)$/i)[1];
    const packKey=Object.keys(combatPacks).find(name=>key(name)===key(pack));
    const group={id:style.id,name:style.name,members:[],issues:[]};
    if(!packKey)group.issues.push(`Unknown combat pack: ${pack}.`);
    for(const name of combatPacks[packKey]??[]) {
      // The supplied actor explicitly names its pack members "... - Fyrdman)".
      const decorated=name.replace(/\)$/,` - ${packKey})`);
      let matches=snapshot.rows.filter(row=>row.type==='skill'&&key(row.name)===key(decorated));
      if(!matches.length)matches=snapshot.rows.filter(row=>row.type==='skill'&&key(row.name)===key(name));
      if(matches.length!==1)group.issues.push(`${name}: ${matches.length?'ambiguous':'missing'} skill.`);
      else group.members.push(matches[0].id);
    }
    snapshot.styles.push(group);style.combatStyle=group;
  }
  for(const row of snapshot.rows) {
    row.memberOfStyles=snapshot.styles.filter(group=>group.members.includes(row.id));
    if(row.combatStyle?.issues.length)snapshot.warnings.push(`${row.name}: ${row.combatStyle.issues.join(' ')}`);
  }
}
export function selectionGroup(snapshot,id) {
  const style=snapshot.styles?.find(group=>group.id===id);
  return style?[id,...style.members]:(snapshot.pairs??[]).find(pair=>pair.includes(id))??[id];
}

export function readPlayerActor(actor,user,role='player') {
  const snapshot=readActor(actor,user,role);
  snapshot.pairs=[];
  const runes=Array.from(actor.items??[]).filter(item=>item.type==='rune');
  const rqid=item=>item.flags?.rqg?.documentRqidFlags?.id??item.getFlag?.('rqg','documentRqidFlags')?.id;
  const seen=new Set();
  for(const rune of runes) {
    const target=rune.system?.opposingRuneRqidLink?.rqid,own=rqid(rune);
    if(!target||!own) continue;
    const matches=runes.filter(item=>rqid(item)===target);
    const other=actor.getBestEmbeddedDocumentByRqid?.(target)??(matches.length===1?matches[0]:null);
    if(other?.type!=='rune'||other.system?.opposingRuneRqidLink?.rqid!==own)continue;
    const ids=[rune.id??rune._id,other.id??other._id].sort();
    if(ids[0]===ids[1]||seen.has(ids.join('|')))continue;
    seen.add(ids.join('|'));snapshot.pairs.push(ids);
  }
  identifyCombatStyles(snapshot);
  snapshot.species=actor.system?.background?.species??null;
  snapshot.privateManager=actor.flags?.world?.companionManager?.schema===2;
  snapshot.characteristics=Object.fromEntries(Object.entries(actor.system?.characteristics??{}).map(([key,stat])=>{
    const checked=stat.hasExperience??null;
    // A native Experience toggle is a new earned tick awaiting collection,
    // separate from ticks already accumulated by this application.
    return [key,{value:stat.value,checked,ticks:role==='gm'&&user?.isGM?managerState(actor,user).statTicks?.[key]??0:snapshot.privateManager?0:actor.flags?.world?.companionManager?.statTicks?.[key]??0}];
  }));
  return snapshot;
}
export function trainingFootprint(id,snapshot) {
  const style=(snapshot.styles??[]).find(group=>group.id===id);
  return new Set([id,...(style?.members??[])]);
}
export function trainingSkillOptions(draft,snapshot,excludeRequestId=null) {
  const assigned=draft.entries.filter(entry=>entry.tp).map(entry=>entry.itemId).concat((draft.downtime?.requests??[]).filter(request=>request.id!==excludeRequestId&&request.trainingSkill).map(request=>request.trainingSkill.itemId));
  const occupied=new Set(assigned.flatMap(id=>[...trainingFootprint(id,snapshot)]));
  return snapshot.rows.filter(row=>allocationOptions(row).tp&&![...trainingFootprint(row.id,snapshot)].some(id=>occupied.has(id))).sort((a,b)=>a.categoryLabel.localeCompare(b.categoryLabel,'en')||a.name.localeCompare(b.name,'en'));
}
export function trainingProgressionDraft(draft,snapshot,{checkCurrent=true}={}) {
  const entries=draft.entries.map(entry=>({...entry,start:{...entry.start}})),occupied=new Set(entries.filter(entry=>entry.tp).flatMap(entry=>[...trainingFootprint(entry.itemId,snapshot)]));
  for(const request of draft.downtime?.requests??[]) {
    if(!request.trainingSkill)continue;
    const target=request.trainingSkill,row=snapshot.rows.find(row=>row.id===target.itemId);
    if(!row||row.type!=='skill'||!allocationOptions({...row,raw:checkCurrent?row.raw:target.start.raw}).tp)throw new Error(`${target.name}: this skill cannot be trained.`);
    if(checkCurrent&&(Object.entries(baseline(row)).some(([key,value])=>target.start[key]!==value)||target.fullBefore!==(Number.isFinite(row.effective)?row.effective:null)))throw new Error(`${target.name}: starting values changed. Choose the Training skill again.`);
    const footprint=trainingFootprint(row.id,snapshot);
    if([...footprint].some(id=>occupied.has(id)))throw new Error(`${row.name}: already trained in this distribution. Use either a TP or Training DP, once.`);
    for(const id of footprint)occupied.add(id);
    let entry=entries.find(entry=>entry.itemId===row.id);
    if(entry) {
      if(Object.entries(target.start).some(([key,value])=>entry.start[key]!==value))throw new Error(`${row.name}: XP/TP and Training starting values differ.`);
      entry.tp=1;
    } else entries.push({itemId:row.id,name:row.name,type:'skill',xp:0,tp:1,direction:'add',start:{...target.start}});
    for(const id of footprint)if(!entries.some(entry=>entry.itemId===id)) {
      const member=snapshot.rows.find(row=>row.id===id);if(!member)throw new Error('Training combat style member is missing.');
      entries.push({itemId:id,name:member.name,type:'skill',xp:0,tp:0,direction:'add',start:baseline(member)});
    }
  }
  return {...draft,entries};
}
export function projectedValues(draft,snapshot,{checkCurrent=true}={}) {
  draft=trainingProgressionDraft(draft,snapshot,{checkCurrent});
  const result=new Map();
  const deltas=new Map();
  for(const entry of draft.entries) {
    const row=snapshot.rows.find(row=>row.id===entry.itemId);
    if(!row)throw new Error(`${entry.name}: missing entry.`);
    if(checkCurrent&&Object.entries(baseline(row)).some(([key,value])=>entry.start[key]!==value))throw new Error(`${row.name}: starting values have changed. Remove and add this entry again.`);
    const gains=unitGains({...row,...entry.start});
    const delta=(entry.xp*(gains.xp??0)+entry.tp*(gains.tp??0))*(entry.direction==='subtract'?-1:1);
    deltas.set(row.id,delta);
    result.set(row.id,{raw:entry.start.raw+delta,full:Number.isFinite(row.effective)?row.effective+delta:null});
    if(row.combatStyle&&Number.isSafeInteger(row.categoryBonus)&&Number.isSafeInteger(row.effective)) {
      const value=result.get(row.id);
      const modifier=row.raw>0&&row.effective>0?row.effective-row.raw:row.categoryBonus;
      value.full=value.raw>0?Math.max(0,value.raw+modifier):0;
    }
  }
  for(const pair of snapshot.pairs??[]) {
    if(!pair.some(id=>result.has(id)))continue;
    for(const id of pair) {
      const row=snapshot.rows.find(row=>row.id===id),entry=draft.entries.find(entry=>entry.itemId===id);
      const raw=entry?.start.raw??row?.raw;
      const other=pair.find(other=>other!==id),otherRow=snapshot.rows.find(row=>row.id===other),otherEntry=draft.entries.find(entry=>entry.itemId===other);
      if(raw+(otherEntry?.start.raw??otherRow?.raw)!==100)throw new Error('Linked rune values must total 100%. Ask the GM to check the sheet.');
      const next=raw+(deltas.get(id)??0)-(deltas.get(other)??0);
      if(next<0||next>100)throw new Error(`${row.name}: projected rune value is outside 0–100%.`);
      result.set(id,{raw:next,full:next});
    }
  }
  const styleTargets=new Map();
  for(const style of snapshot.styles??[]) {
    const entry=draft.entries.find(entry=>entry.itemId===style.id);
    if(!entry||!entry.xp&&!entry.tp)continue;
    if(style.issues.length)throw new Error(`${style.name}: ${style.issues.join(' ')}`);
    const full=result.get(style.id)?.full;
    if(!Number.isSafeInteger(full))throw new Error(`${style.name}: full value unavailable.`);
    for(const id of style.members) {
      const member=snapshot.rows.find(row=>row.id===id),saved=draft.entries.find(entry=>entry.itemId===id);
      if(!member||!saved)throw new Error(`${style.name}: select the style again to include every member.`);
      if(saved.xp||saved.tp)throw new Error(`${member.name}: allocate points to the combat style, not its members.`);
      if(!Number.isSafeInteger(member.effective))throw new Error(`${member.name}: full value unavailable.`);
      if(styleTargets.has(id)&&styleTargets.get(id)!==full)throw new Error(`${member.name}: selected combat styles require different values.`);
      const modifier=member.raw>0&&member.effective>0?member.effective-member.raw:member.categoryBonus;
      const raw=full-modifier;
      if(!Number.isSafeInteger(raw)||raw<member.base)throw new Error(`${member.name}: the style target is below this skill's base and modifiers.`);
      styleTargets.set(id,full);result.set(id,{raw,full});
    }
  }
  for(const [id,value]of result)if(value.raw<0)throw new Error(`${snapshot.rows.find(row=>row.id===id).name}: projected value is negative.`);
  return result;
}

export function learningMode(row) {
  if(row.memberOfStyles?.length)return 'Style member';
  if (!row.canGetExperience) return 'Study only';
  if (row.raw > 90) return 'Imp. only';
  if (row.raw > 75) return 'Exp. only';
  return 'Normal';
}
export function allocationOptions(row) {
  const gains = unitGains(row);
  const blocked=row.memberOfStyles?.length||row.combatStyle?.issues.length;
  return {
    xp: !blocked && row.canGetExperience && gains.xp !== null,
    tp: !blocked && row.type === 'skill' && gains.tp !== null,
    mode: learningMode(row)
  };
}
export function validatePlayerDraft(draft, snapshot) {
  validateSeasonTraining(draft,snapshot);
  const downtime=validateDowntime(draft),effective=trainingProgressionDraft(draft,snapshot),trainingTP=(draft.downtime?.requests??[]).filter(request=>request.trainingSkill).length;
  for (const entry of effective.entries) {
    if (![0,1].includes(entry.xp) || ![0,1].includes(entry.tp)) throw new Error(`${entry.name}: select at most one XP and one TP per distribution. Remove and add this entry again if it came from an older version.`);
    const row = snapshot.rows.find(row => row.id === entry.itemId);
    if (!row) throw new Error(`${entry.name}: this entry no longer exists.`);
    const options = allocationOptions(row);
    if (entry.xp && !options.xp) throw new Error(`${row.name}: XP is unavailable (${options.mode}${options.mode === 'Imp. only' ? '; an experience tick is required' : ''}).`);
    if (entry.tp && !options.tp) throw new Error(`${row.name}: training is unavailable. TP requires a skill with a raw value of 75% or less.`);
  }
  // Unchecked rows are a local selection, not a submitted request.
  const amounts=availableAmounts(draft);
  const balances=validateDraft({ amounts:{...amounts,tp:Number.isSafeInteger(amounts.tp)?amounts.tp+trainingTP:amounts.tp}, entries: effective.entries.filter(entry => entry.xp || entry.tp) }, snapshot);
  balances.used.tp-=trainingTP;balances.used.dp=downtime.used;balances.remaining.dp=downtime.remaining;
  projectedValues(draft,snapshot);
  return balances;
}

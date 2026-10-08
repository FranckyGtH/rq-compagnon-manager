import { MODULE_ID, listActors, readActor, filterRows, escapeHTML as esc } from './core.mjs';
import { baseline, parseQuantity, canSaveNotes } from './distribution.mjs';
import { allocationOptions, learningMode, validatePlayerDraft, readPlayerActor, projectedValues, selectionGroup, trainingFootprint } from './player-rules.mjs';
import { readReadableDistribution, saveReadableDistribution } from './readable-notes.mjs';
import { seasons, trainingStats, defaultTraining, seasonalTP, availableAmounts, characteristicOptions, validateSeasonTraining, progressionMarkdown, managerProgressionMarkdown } from './season-training.mjs';
import { attachDowntime } from './downtime-application.mjs';
import { downtimeDP } from './downtime-rules.mjs';
import { managerState, dmDossiers } from './manager-state.mjs';

export class PlayerProgressionApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, 'kp-player-v04'], tag: 'div',
    window: { icon: 'fa-solid fa-leaf', resizable: true },
    position: { width: 1000, height: 950 }
  };
  constructor({actorId=null,role='player'}={}) {
    super({id:`${MODULE_ID}-${role}-v04`});
    this.role=role;
    this.actorId=actorId; this.states=new Map();
    this.filters={type:'skill',category:'',search:'',ticksOnly:false,sort:'category'};
  }
  get title() { return `RQ compagnon Manager ${this.role==='gm'?'DM':'PC'} · v0.17.3`; }
  loadState(snapshot) {
    try {
      const loaded=readReadableDistribution(game.actors.get(snapshot.id).system?.background?.biography,snapshot);
      loaded.draft.seasons??=[];loaded.draft.training??=defaultTraining(snapshot);
      for(const pair of snapshot.pairs??[])if(pair.some(id=>loaded.draft.entries.some(entry=>entry.itemId===id)))for(const id of pair) {
        if(loaded.draft.entries.some(entry=>entry.itemId===id))continue;
        const row=snapshot.rows.find(row=>row.id===id);
        loaded.draft.entries.push({itemId:id,name:row.name,type:row.type,xp:0,tp:0,direction:'add',start:baseline(row)});
      }
      for(const style of snapshot.styles??[])if(loaded.draft.entries.some(entry=>entry.itemId===style.id))for(const id of style.members) {
        if(loaded.draft.entries.some(entry=>entry.itemId===id))continue;
        const row=snapshot.rows.find(row=>row.id===id);
        loaded.draft.entries.push({itemId:id,name:row.name,type:row.type,xp:0,tp:0,direction:'add',start:baseline(row)});
      }
      this.states.set(snapshot.id,{...loaded,dirty:false,error:null});
    } catch(error) { this.states.set(snapshot.id,{dirty:false,error:error.message}); }
  }
  async _prepareContext(options) {
    const context=await super._prepareContext(options);
    const actors=listActors(game.actors,game.user,this.role);
    if(!actors.some(actor=>actor.id===this.actorId)) this.actorId=actors[0]?.id??null;
    const actor=this.actorId?game.actors.get(this.actorId):null;
    const snapshot=actor?readPlayerActor(actor,game.user,this.role):null;
    if(snapshot) {
      const state=this.states.get(snapshot.id);
      if(!state||!state.dirty) this.loadState(snapshot);
    }
    return {...context,actors,snapshot};
  }
  async refresh() {
    try { await this.render({force:true}); }
    catch(error) { ui.notifications.error(error.message); }
  }
  _replaceHTML(root,content) { content.replaceChildren(root); }
  async _renderHTML({actors,snapshot}) {
    this.tableObservers?.forEach(observer=>observer.disconnect());
    this.tableObservers=[];
    const root=document.createElement('div'); root.className='kp-content';
    root.innerHTML=`<div class="kp-intro"><div><h1 class="kp-manager-title">RQ compagnon Manager ${this.role==='gm'?'DM':'PC'} · v0.17.3</h1><strong>Character Progression</strong><p>Prepare a request for your DM</p></div><span class="kp-badge">Requests only</span></div>
      <div class="kp-selection"><label>Character<select data-actor>${actors.map(actor=>`<option value="${esc(actor.id)}" ${actor.id===this.actorId?'selected':''}>${esc(actor.name)}</option>`).join('')||'<option>No accessible character</option>'}</select></label><button type="button" data-refresh>Refresh sheet</button></div>
      <footer>v0.17.3 · Only the DM assigns budgets. PC saves update request notes only.</footer>`;
    root.querySelector('[data-actor]').addEventListener('change',event=>{this.actorId=event.target.value;this.filters.category='';void this.refresh();});
    root.querySelector('[data-refresh]').addEventListener('click',()=>void this.refresh());
    if(!snapshot) return root;
    const state=this.states.get(snapshot.id),actor=game.actors.get(snapshot.id);
    const panel=document.createElement('div'); panel.className='kp-player-panel';
    root.insertBefore(panel,root.querySelector('footer'));
    if(state.error) {
      panel.innerHTML=`<div class="kp-warning">${esc(state.error)}<p>Saving is blocked to preserve the existing notes.</p></div><button type="button" data-reload>Reload notes</button>`;
      panel.querySelector('[data-reload]').addEventListener('click',()=>{this.loadState(snapshot);void this.refresh();});
      return root;
    }
    panel.innerHTML=`<div class="kp-resources" data-summary aria-live="polite">${['xp','tp','dp'].map(k=>`<section class="kp-resource" data-resource="${k}"><h2>${k.toUpperCase()}</h2><label>${this.role==='gm'?'To assign':'Assigned by DM'}<input type="number" min="0" max="1000000" step="1" data-budget="${k}" value="${state.draft.amounts[k]??''}" ${this.role==='gm'?'':'disabled'}></label><div class="kp-resource-totals"><div><span>Allocated</span><strong data-used="${k}">0</strong></div><div><span>Remaining</span><strong data-remaining="${k}">0</strong></div></div></section>`).join('')}</div>
      <div class="kp-warning" data-error hidden></div>
      ${snapshot.warnings.length?`<div class="kp-warning">${snapshot.warnings.map(esc).join('<br>')}</div>`:''}
      <div class="kp-filters"><label>Type<select data-type><option value="skill">Skills (${snapshot.counts.skill})</option><option value="passion">Passions (${snapshot.counts.passion})</option><option value="rune">Runes (${snapshot.counts.rune})</option></select></label>
      <label>Category<select data-category></select></label><label>Sort<select data-sort><option value="category">Category / name</option><option value="full-asc">Full value: low to high</option><option value="full-desc">Full value: high to low</option></select></label>
      <label>Search<input type="search" data-search placeholder="Name or category" value="${esc(this.filters.search)}"></label><label><input type="checkbox" data-ticks-only ${this.filters.ticksOnly?'checked':''}> Exp. Tick only</label></div>
      <p data-count></p><div class="kp-table-wrap kp-browser"><table><thead><tr><th>Name</th><th>Category</th><th>Raw</th><th>Full</th><th>Exp. Tick</th><th>Learning Mode</th><th></th></tr></thead><tbody data-browser></tbody></table></div>
      <p class="kp-help">New value shows the full value; hover for raw. Linked runes are selected together. Combat Styles include all their skills: allocate points to the style to synchronize full values and clear all member ticks. Use the Downtime screen to propose DP investments.</p>
      <div class="kp-selected-heading"><h3>Selected entries</h3><button type="button" data-clear-all>Clear all</button></div><div class="kp-table-wrap kp-allocations"><table><thead><tr><th>Name</th><th>Raw</th><th>Full</th><th>Exp. Tick</th><th>Learning Mode</th><th>XP</th><th>TP</th><th>New value</th><th>Direction</th><th></th></tr></thead><tbody data-entries></tbody></table></div>
      <p data-state aria-live="polite"></p><div class="kp-actions"><button type="button" data-save>Save request to notes</button><button type="button" data-reload>Reload notes (discard draft)</button></div>`;
    const percent=value=>Number.isFinite(value)?`${value} %`:'—';
    const current=()=>readPlayerActor(actor,game.user,this.role);
    const canSave=()=>canSaveNotes(actor,game.user,this.role);
    const updateSummary=()=>{
      const available=availableAmounts(state.draft);
      // PC controls show the actual available total. The GM base budgets stay
      // separate in the draft, so seasonal choices cannot alter the assignment.
      if(this.role!=='gm')panel.querySelectorAll('[data-budget]').forEach(input=>{input.value=available[input.dataset.budget]??'';});
      const used={xp:0,tp:0,dp:downtimeDP(state.draft)};state.draft.entries.forEach(entry=>{used.xp+=entry.xp;used.tp+=entry.tp;});
      for(const k of ['xp','tp','dp']) {
        panel.querySelector(`[data-used="${k}"]`).textContent=used[k];
        const remaining=state.draft.amounts[k]===null?null:available[k]-used[k];
        const cell=panel.querySelector(`[data-remaining="${k}"]`);cell.textContent=remaining??'—';cell.classList.toggle('kp-overdrawn',remaining<0);
      }
      const errorPanel=panel.querySelector('[data-error]');let valid=true;
      try {
        if(this.role==='gm')panel.querySelectorAll('[data-budget]').forEach(input=>parseQuantity(input.value));
        validatePlayerDraft(state.draft,current());
        if(this.role!=='gm')validateSeasonTraining(state.draft,current(),{requireChoices:true});
        errorPanel.hidden=true;errorPanel.textContent='';
      } catch(error) {valid=false;errorPanel.hidden=false;errorPanel.textContent=error.message;}
      let preview=new Map();
      try{preview=projectedValues(state.draft,current());}catch{/* Validation above explains the unavailable preview. */}
      for(const target of panel.querySelectorAll('[data-training-target]')) {
        const request=state.draft.downtime?.requests.find(request=>request.id===target.closest('[data-activity]').dataset.activity);
        if(request?.trainingSkill){const value=preview.get(request.trainingSkill.itemId);target.innerHTML=`<strong>${esc(request.trainingSkill.name)}</strong> · 1 DP → 1 TP applied to this skill · New full: ${percent(value?.full)} · New raw: ${percent(value?.raw)}`;}
      }
      panel.querySelectorAll('[data-entry]').forEach(tr=>{
        const entry=state.draft.entries.find(entry=>entry.itemId===tr.dataset.entry);
        const row=current().rows.find(row=>row.id===entry.itemId);
        const allowed=row?allocationOptions(row):{xp:false,tp:false};
        const value=preview.get(entry.itemId),cell=tr.querySelector('[data-new-value]');
        cell.textContent=percent(value?.full);
        cell.title=value?`New raw: ${percent(value.raw)}`:'Preview unavailable';
        const legacy=![0,1].includes(entry.xp)||![0,1].includes(entry.tp);
        tr.querySelectorAll('[data-allocate]').forEach(input=>{
          const resource=input.dataset.allocate,budget=available[resource];
          const exhausted=!Number.isSafeInteger(budget)||used[resource]>=budget;
          const dpTraining=resource==='tp'&&(state.draft.downtime?.requests??[]).some(request=>request.trainingSkill&&[...trainingFootprint(request.trainingSkill.itemId,snapshot)].some(id=>trainingFootprint(entry.itemId,snapshot).has(id)));
          input.disabled=legacy||!allowed[resource]||dpTraining||(!entry[resource]&&exhausted);
          input.title=dpTraining?'Already trained with Training DP':!allowed[resource]?(resource==='xp'?'XP unavailable':'Training unavailable'):!entry[resource]&&exhausted?'No points remaining':`Allocate one ${resource.toUpperCase()}`;
        });
      });
      panel.querySelector('[data-save]').disabled=!valid||!canSave()||(this.role!=='gm'&&state.origin!=='GM declaration');
      panel.querySelector('[data-clear-all]').disabled=state.draft.entries.length===0;
      const bonus=panel.querySelector('[data-season-bonus]');if(bonus)bonus.textContent=`Season bonus: +${seasonalTP(state.draft)} TP · Total available: ${available.tp??'—'}`;
      panel.querySelector('[data-state]').textContent=!canSave()?'Read access only: this draft cannot be saved to the character.':this.role!=='gm'&&state.origin!=='GM declaration'?'Ask the DM to assign and save the budgets before submitting a request.':state.dirty?'Unsaved draft. Kept in this application until you reload the browser.':state.present?'Request loaded from character notes.':'No saved request. Saving will create the dedicated note sections.';
    };
    const modeTitle=row=>{
      if(row.combatStyle)return row.combatStyle.issues.length?row.combatStyle.issues.join(' '):`Updates together: ${row.combatStyle.members.map(id=>snapshot.rows.find(member=>member.id===id).name).join(', ')}. All member experience ticks will be cleared.`;
      if(row.memberOfStyles?.length)return `Managed through ${row.memberOfStyles.map(group=>group.name).join(', ')}. Select the combat style to allocate points.`;
      const allowed=allocationOptions(row);
      if(!allowed.xp&&!allowed.tp) return row.canGetExperience?'XP requires an experience tick; training is unavailable.':'Study only, but training is unavailable above 75% raw (or for a non-skill).';
      return allowed.mode==='Imp. only'?'XP requires an experience tick.':allowed.mode==='Exp. only'?'XP only; training is unavailable above 75% raw.':allowed.mode==='Study only'?'TP only; XP is unavailable.':'XP and TP are available.';
    };
    const renderEntries=()=>{
      const rows=current().rows;
      panel.querySelector('[data-entries]').innerHTML=state.draft.entries.map(entry=>{
        const row=rows.find(r=>r.id===entry.itemId);const allowed=row?allocationOptions(row):{xp:false,tp:false};
        const legacy=![0,1].includes(entry.xp)||![0,1].includes(entry.tp);
        return `<tr data-entry="${esc(entry.itemId)}"><td>${esc(entry.name)}${legacy?'<br><small>Old quantities: remove and add again</small>':''}</td><td>${percent(entry.start.raw)}</td><td>${percent(row?.effective)}</td><td>${entry.start.tick?'✓':'—'}</td><td title="${esc(row?modeTitle(row):'Missing entry')}">${row?learningMode(row):'Unavailable'}</td>
          <td><input type="checkbox" data-allocate="xp" aria-label="XP ${esc(entry.name)}" ${entry.xp?'checked':''} ${!allowed.xp||legacy?'disabled':''} title="${allowed.xp?'Allocate one XP':'XP unavailable'}"></td>
          <td><input type="checkbox" data-allocate="tp" aria-label="TP ${esc(entry.name)}" ${entry.tp?'checked':''} ${!allowed.tp||legacy?'disabled':''} title="${allowed.tp?'Allocate one TP':'Training unavailable'}"></td>
          <td data-new-value>—</td><td>${entry.type==='skill'?'Increase':`<select data-direction aria-label="Direction ${esc(entry.name)}"><option value="add" ${entry.direction==='add'?'selected':''}>Increase</option><option value="subtract" ${entry.direction==='subtract'?'selected':''}>Decrease</option></select>`}</td><td><button type="button" data-remove>${(snapshot.pairs??[]).some(pair=>pair.includes(entry.itemId))?'Remove pair':'Remove'}</button></td></tr>`;
      }).join('')||'<tr><td colspan="10" class="kp-empty">Select entries from the list above.</td></tr>';
      panel.querySelectorAll('[data-entry]').forEach(tr=>{
        const entry=state.draft.entries.find(entry=>entry.itemId===tr.dataset.entry);
        tr.querySelectorAll('[data-allocate]').forEach(input=>input.addEventListener('change',()=>{
          entry[input.dataset.allocate]=input.checked?1:0;state.dirty=true;updateSummary();
        }));
        tr.querySelector('[data-direction]')?.addEventListener('change',event=>{entry.direction=event.target.value;state.dirty=true;updateSummary();});
        tr.querySelector('[data-remove]').addEventListener('click',()=>{
          const owners=(snapshot.styles??[]).filter(group=>group.id===entry.itemId||group.members.includes(entry.itemId));
          const remove=new Set(owners.length?owners.map(group=>group.id):selectionGroup(snapshot,entry.itemId));
          for(const owner of owners)for(const id of owner.members)if(!(snapshot.styles??[]).some(other=>!remove.has(other.id)&&other.members.includes(id)&&state.draft.entries.some(e=>e.itemId===other.id)))remove.add(id);
          state.draft.entries=state.draft.entries.filter(e=>!remove.has(e.itemId));state.dirty=true;renderEntries();renderBrowser();
        });
      });
      updateSummary();
    };
    const renderBrowser=()=>{
      const rows=filterRows(current().rows,this.filters);
      panel.querySelector('[data-count]').textContent=`${rows.length} entries shown · ${this.filters.sort==='full-asc'?'Full value: low to high':this.filters.sort==='full-desc'?'Full value: high to low':'sorted by category, then name'}`;
      panel.querySelector('[data-browser]').innerHTML=rows.map(row=>{
        const selected=state.draft.entries.some(entry=>entry.itemId===row.id);
        const allowed=allocationOptions(row);
        const partnerId=(snapshot.pairs??[]).find(pair=>pair.includes(row.id))?.find(id=>id!==row.id);
        const partner=current().rows.find(r=>r.id===partnerId),partnerCan=partner?allocationOptions(partner):{xp:false,tp:false};
        return `<tr><td>${esc(row.name)}</td><td>${esc(row.categoryLabel)}</td><td>${percent(row.raw)}</td><td>${percent(row.effective)}</td><td>${row.tick?'✓':'—'}</td><td title="${esc(modeTitle(row))}">${learningMode(row)}</td><td><button type="button" data-add="${esc(row.id)}" ${selected||!allowed.xp&&!allowed.tp&&!partnerCan.xp&&!partnerCan.tp?'disabled':''}>${selected?'Selected':partner?'Add pair':'Add'}</button></td></tr>`;
      }).join('')||'<tr><td colspan="7" class="kp-empty">No matching entries.</td></tr>';
      panel.querySelectorAll('[data-add]').forEach(button=>button.addEventListener('click',()=>{
        try {
          const row=current().rows.find(row=>row.id===button.dataset.add);
          if(!row) throw new Error('This entry is no longer accessible.');
          if(state.draft.entries.some(entry=>entry.itemId===row.id)) return;
          const ids=selectionGroup(snapshot,row.id);
          for(const id of ids) {
            if(state.draft.entries.some(entry=>entry.itemId===id))continue;
            const selected=current().rows.find(row=>row.id===id);
            state.draft.entries.push({itemId:selected.id,name:selected.name,type:selected.type,xp:0,tp:0,direction:'add',start:baseline(selected)});
          }
          state.dirty=true;renderEntries();renderBrowser();
        } catch(error) {ui.notifications.warn(error.message);}
      }));
    };
    const category=panel.querySelector('[data-category]');
    const fillCategories=()=>{
      const categories=new Map(current().rows.filter(row=>row.type===this.filters.type).map(row=>[row.category,row.categoryLabel]));
      if(!categories.has(this.filters.category)) this.filters.category='';
      category.innerHTML='<option value="">All categories</option>'+[...categories].sort((a,b)=>a[1].localeCompare(b[1],'en')).map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');
      category.value=this.filters.category;
    };
    panel.querySelector('[data-type]').value=this.filters.type;
    panel.querySelector('[data-type]').addEventListener('change',event=>{this.filters.type=event.target.value;this.filters.category='';fillCategories();renderBrowser();});
    category.addEventListener('change',event=>{this.filters.category=event.target.value;renderBrowser();});
    panel.querySelector('[data-search]').addEventListener('input',event=>{this.filters.search=event.target.value;renderBrowser();});
    panel.querySelector('[data-sort]').value=this.filters.sort;
    panel.querySelector('[data-sort]').addEventListener('change',event=>{this.filters.sort=event.target.value;renderBrowser();});
    panel.querySelector('[data-ticks-only]').addEventListener('change',event=>{this.filters.ticksOnly=event.target.checked;renderBrowser();});
    panel.querySelectorAll('[data-budget]').forEach(input=>input.addEventListener('input',()=>{
      try {state.draft.amounts[input.dataset.budget]=parseQuantity(input.value);}catch{state.draft.amounts[input.dataset.budget]=null;}
      state.dirty=true;updateSummary();
    }));
    panel.querySelector('[data-reload]').addEventListener('click',()=>{this.loadState(current());void this.refresh();});
    panel.querySelector('[data-clear-all]').addEventListener('click',async()=>{
      if(state.draft.entries.length===0)return;
      const controls=[...root.querySelectorAll('input,select,button')],disabled=controls.map(input=>input.disabled);
      controls.forEach(input=>{input.disabled=true;});
      try {
        const confirmed=await foundry.applications.api.DialogV2.confirm({
          window:{title:'Clear selected entries'},
          content:`<p>Remove all ${state.draft.entries.length} selected entries for <strong>${esc(snapshot.name)}</strong>?</p><p>Your XP, TP and DP budgets will be kept. This clears the draft only; use Save request to notes to save the change.</p>`,
          yes:{label:'Clear all',icon:'fas fa-trash'},
          no:{label:'Cancel',icon:'fas fa-times',default:true}
        });
        if(confirmed===true) {
          current();
          state.draft.entries=[];state.dirty=true;
          renderEntries();renderBrowser();
        }
      } catch(error) {ui.notifications.error(error.message);}
      finally {
        controls.forEach((input,index)=>{input.disabled=disabled[index];});
        updateSummary();
      }
    });
    panel.querySelector('[data-save]').addEventListener('click',async()=>{
      const controls=[...root.querySelectorAll('input,select,button')],disabled=controls.map(input=>input.disabled);
      try {
        if(this.role==='gm'&&this.dossierReady===false)throw new Error('Initialize / migrate the character dossier in Summary first.');
        if(this.role==='gm') {
          panel.querySelectorAll('[data-budget]').forEach(input=>{state.draft.amounts[input.dataset.budget]=parseQuantity(input.value);});
          for(const [selector,key]of [['[data-initial-dex]','initialDex'],['[data-species-maximum]','speciesMaximum']]) {
            const input=panel.querySelector(selector);
            if(input)state.draft.training[key]=input.value===''?null:Number(input.value);
          }
        }
        validatePlayerDraft(state.draft,current());
        const draft=JSON.parse(JSON.stringify(state.draft));
        controls.forEach(input=>{input.disabled=true;});
        const saved=await saveReadableDistribution(actor,game.user,this.role,draft,state.fingerprint);
        this.states.set(actor.id,{...saved,dirty:false,error:null});
        ui.notifications.info('Request saved to notes. No progression values were applied.');
        await this.refresh();
      } catch(error) {ui.notifications.error(error.message);controls.forEach((input,index)=>{input.disabled=disabled[index];});}
    });
    fillCategories();renderBrowser();renderEntries();
    this.attachScreens(root,panel,state,snapshot,updateSummary);
    this.fixedTableHeaders(panel);
    return root;
  }
  attachScreens(root,panel,state,snapshot,updateSummary) {
    this.updateDistributionSummary=updateSummary;
    const nav=document.createElement('div');nav.className='kp-screen-nav';
    const screens=new Map();
    const xp=document.createElement('section');xp.className='kp-screen';xp.dataset.screen='progression';
    const common=new Set([panel.querySelector('[data-state]'),panel.querySelector('.kp-actions'),panel.querySelector('[data-error]')]);
    for(const node of [...panel.children])if(!common.has(node))xp.append(node);
    panel.prepend(nav,xp);screens.set('progression',xp);
    const downtime=document.createElement('section');downtime.className='kp-screen';downtime.dataset.screen='downtime';
    downtime.innerHTML='<h3>Downtime</h3><p>DP budgets are kept here. DP are allocated to activity requests below.</p>';
    downtime.append(xp.querySelector('[data-resource=dp]'));attachDowntime(this,downtime,state,game.actors.get(snapshot.id),updateSummary);screens.set('downtime',downtime);
    const bonus=document.createElement('p');bonus.className='kp-help';bonus.dataset.seasonBonus='';xp.querySelector('[data-resource=tp]').append(bonus);
    const training=document.createElement('section');training.className='kp-screen';training.dataset.screen='training';screens.set('training',training);
    const renderTraining=()=>{
      const options=characteristicOptions(snapshot,state.draft.training);
      training.innerHTML=`<h3>End of season training</h3><p>Each reward grants 2 TP or 1 characteristic tick. Rewards stack. Only the DM applies changes; characteristic values are not increased automatically.</p>
      ${this.role==='gm'?`<div class="kp-actions"><select data-add-season>${seasons.map(season=>`<option>${esc(season)}</option>`).join('')}</select><button type="button" data-add-season-reward>Add season reward</button></div>`:''}
      <div class="kp-season-rewards">${state.draft.seasons.map(reward=>`<div class="kp-season-row" data-season-reward="${esc(reward.id)}"><strong>End of ${esc(reward.season)}${reward.season==='Sacred Time'?'':' Season'}</strong><select data-season-choice aria-label="Training choice"><option value="pending" ${reward.choice==='pending'?'selected':''}>Choose reward</option><option value="tp" ${reward.choice==='tp'?'selected':''}>2 TP</option><option value="stat" ${reward.choice==='stat'?'selected':''}>1 Stat Tick</option></select>${reward.choice==='stat'?`<select data-season-stat aria-label="Characteristic"><option value="">Choose characteristic</option>${options.map(option=>`<option value="${option.key}" ${reward.stat===option.key?'selected':''} ${option.reason?'disabled':''}>${option.label} (${option.value??'—'})${option.reason?` — ${esc(option.reason)}`:''}</option>`).join('')}</select>`:''}${this.role==='gm'?'<button type="button" data-remove-season>Remove reward</button>':''}</div>`).join('')||'<p>No seasonal rewards assigned.</p>'}</div>
      ${this.role==='gm'||snapshot.privateManager?'':`<h3>Accumulated characteristic ticks</h3><p>${options.map(option=>`${option.label}: ${option.ticks}`).join(' · ')}</p>`}<p class="kp-help">INT and SIZ cannot be trained. DEX is limited to initial DEX × 1.5 or the species maximum, whichever is lower. The DM manages characteristic tick counters.</p>`;
      training.querySelector('[data-add-season-reward]')?.addEventListener('click',()=>{
        const id=globalThis.crypto?.randomUUID?.()??foundry.utils.randomID(32);
        state.draft.seasons.push({id,season:training.querySelector('[data-add-season]').value,choice:'pending',stat:null,start:null});state.dirty=true;renderTraining();updateSummary();
      });
      training.querySelectorAll('[data-season-reward]').forEach(row=>{
        const reward=state.draft.seasons.find(reward=>reward.id===row.dataset.seasonReward);
        row.querySelector('[data-season-choice]').addEventListener('change',event=>{reward.choice=event.target.value;reward.stat=null;reward.start=null;state.dirty=true;renderTraining();updateSummary();});
        row.querySelector('[data-season-stat]')?.addEventListener('change',event=>{reward.stat=event.target.value||null;const stat=snapshot.characteristics?.[reward.stat];reward.start=stat?{value:stat.value,ticks:stat.ticks,checked:stat.checked}:null;state.dirty=true;updateSummary();});
        row.querySelector('[data-remove-season]')?.addEventListener('click',()=>{state.draft.seasons=state.draft.seasons.filter(other=>other.id!==reward.id);state.dirty=true;renderTraining();updateSummary();});
      });
    };this.renderSeasonTraining=renderTraining;renderTraining();
    if(this.role==='gm') {
      const summary=document.createElement('section');summary.className='kp-screen';summary.dataset.screen='summary';screens.set('summary',summary);
      summary.innerHTML='<h3>Obsidian summary</h3><label>Source<select data-summary-source><option value="pending">Pending distribution</option><option value="applied">Last applied distribution</option></select></label><p data-summary-status></p><textarea data-markdown rows="10" readonly aria-label="Markdown summary"></textarea><button type="button" data-copy-summary>Copy Markdown</button>';
      if(!state.draft.entries.some(entry=>entry.xp||entry.tp)&&!state.draft.seasons.length&&managerState(game.actors.get(snapshot.id)).history?.length)summary.querySelector('[data-summary-source]').value='applied';
      const fillSummary=()=>{
        const store=managerState(game.actors.get(snapshot.id)),tx=store?.history?.at(-1),applied=summary.querySelector('[data-summary-source]').value==='applied';
        summary.querySelector('[data-markdown]').value=managerProgressionMarkdown(state.draft,snapshot,store,applied,dmDossiers.get(snapshot.uuid)?.data.downtime);
        summary.querySelector('[data-summary-status]').textContent=applied?(tx?`Applied ${tx.completedAt}`:'No applied distribution recorded.'):'Preview of the current distribution; changes are pending DM approval.';
      };
      this.updateMarkdownSummary=fillSummary;
      summary.querySelector('[data-summary-source]').addEventListener('change',fillSummary);
      summary.querySelector('[data-copy-summary]').addEventListener('click',async()=>{
        const textarea=summary.querySelector('[data-markdown]');textarea.focus();textarea.select();
        try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(textarea.value);else if(!document.execCommand('copy'))throw new Error('Copy unavailable');ui.notifications.info('Markdown summary copied.');}catch{ui.notifications.info('Summary selected. Press Ctrl+C to copy it.');}
      });fillSummary();
    }
    const labels={progression:'XP / TP',training:'Season training',downtime:'Downtime',summary:'Summary'};
    for(const id of ['progression','training','downtime','summary'].filter(id=>screens.has(id))) {
      const screen=screens.get(id);
      if(id!=='progression')panel.insertBefore(screen,panel.querySelector('[data-state]'));
      const button=document.createElement('button');button.type='button';button.textContent=labels[id];button.dataset.screenTab=id;nav.append(button);
      button.addEventListener('click',()=>{this.screen=id;show();});
    }
    const show=()=>{for(const [id,screen]of screens)screen.hidden=id!==(this.screen??'progression');for(const button of nav.children)button.setAttribute('aria-pressed',String(button.dataset.screenTab===(this.screen??'progression')));this.updateMarkdownSummary?.();};show();updateSummary();
  }
  fixedTableHeaders(panel) {
    for(const wrapper of panel.querySelectorAll('.kp-table-wrap')) {
      const table=wrapper.querySelector('table');
      const widths=wrapper.classList.contains('kp-browser')?[25,17,8,8,10,17,15]:[19,7,7,9,13,5,5,10,15,10];
      const colgroup=document.createElement('colgroup');
      widths.forEach(width=>{const col=document.createElement('col');col.style.width=`${width}%`;colgroup.append(col);});
      table.prepend(colgroup);
      const header=document.createElement('div');header.className='kp-fixed-head';
      const headerTable=document.createElement('table');headerTable.append(colgroup.cloneNode(true),table.tHead.cloneNode(true));header.append(headerTable);
      table.tHead.hidden=true;
      const body=document.createElement('div');body.className='kp-scrolling-body';body.append(table);
      wrapper.append(header,body);
      body.addEventListener('scroll',()=>{header.scrollLeft=body.scrollLeft;},{passive:true});
      const observer=new ResizeObserver(()=>{headerTable.style.width=`${table.getBoundingClientRect().width}px`;});
      observer.observe(table);this.tableObservers.push(observer);
    }
  }
  async close(options) {
    this.tableObservers?.forEach(observer=>observer.disconnect());
    return super.close(options);
  }
}

import { emptyDowntime, downtimeTypes, downtimePrompts, downtimeStatuses, downtimeDP } from './downtime-rules.mjs';
import { escapeHTML as esc } from './core.mjs';
import { readPlayerActor, trainingSkillOptions, projectedValues } from './player-rules.mjs';
import { baseline } from './distribution.mjs';
import { dmDossiers } from './manager-state.mjs';

export function attachDowntime(app,screen,state,actor,updateSummary) {
  const area=document.createElement('div');area.className='kp-downtime';screen.append(area);
  const value=()=>state.draft.downtime??emptyDowntime();
  const store=()=>state.draft.downtime??=emptyDowntime();
  app.downtimeStatusFilter??='open';
  const render=()=>{
    const shared=value(),ids=[...new Set([...shared.activities.map(a=>a.id),...shared.requests.map(a=>a.id)])];
    let preview=new Map();try{preview=projectedValues(state.draft,readPlayerActor(actor,game.user,app.role));}catch{}
    area.innerHTML=`<p>Propose activities and DP investments. Training: choose an eligible skill, spending 1 DP for one training. The DM applies the skill increase with the distribution. A skill can be trained once per distribution, using either TP or Training DP.</p><label>Status<select data-downtime-status><option value="all">All statuses</option>${Object.entries(downtimeStatuses).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></label><p data-downtime-count aria-live="polite"></p><button type="button" data-new-activity>Add activity</button><div data-activities>${ids.map(id=>{
      const activity=shared.activities.find(a=>a.id===id),wish=shared.requests.find(a=>a.id===id),shown=wish??activity;
      return `<article class="kp-downtime-card" data-activity="${esc(id)}"><h3>${esc(shown.title)}</h3><p>${esc(downtimeTypes[shown.type])} · ${esc(downtimeStatuses[activity?.status??'open'])}</p><p>DP invested: <strong>${activity?.invested??0}</strong> · DP required: <strong>${activity?.required??'Hidden / not set'}</strong> · Requested: <strong>${wish?.dp??0}</strong></p>${shown.type==='training'?`<p data-training-progress>Converted: <strong>${activity?.convertedDP??0} DP → ${activity?.convertedDP??0} TP</strong> · Invested DP not yet converted: <strong>${(activity?.invested??0)-(activity?.convertedDP??0)}</strong></p>`:''}${wish?.trainingSkill?`<p data-training-target><strong>${esc(wish.trainingSkill.name)}</strong> · 1 DP → 1 TP applied to this skill · New full: ${preview.get(wish.trainingSkill.itemId)?.full??'—'}% · New raw: ${preview.get(wish.trainingSkill.itemId)?.raw??'—'}%</p>`:''}<p class="kp-dt-text">${esc(shown.description)}</p><p class="kp-dt-text"><strong>DM response</strong><br>${esc(activity?.response||'No published response.')}</p><button type="button" data-propose ${activity&&activity.status!=='open'?'disabled':''}>${wish?'Edit request':'Propose DP / details'}</button>${wish?'<button type="button" data-withdraw>Withdraw request</button>':''}${app.role==='gm'?'<button type="button" data-dm-details>DM details / publish response</button>':''}${app.role==='gm'&&activity?.type==='training'?`<button type="button" data-convert-training ${['open','complete'].includes(activity.status)&&activity.invested>(activity.convertedDP??0)?'':'disabled'}>Convert invested DP → TP</button>`:''}<div data-editor></div></article>`;
    }).join('')}</div><p data-downtime-empty hidden>No activities match this status.</p><div data-new-editor></div>`;
    const filter=area.querySelector('[data-downtime-status]');filter.value=app.downtimeStatusFilter;
    const applyFilter=()=>{
      const cards=[...area.querySelectorAll('[data-activity]')];let visible=0;
      for(const card of cards){const status=value().activities.find(a=>a.id===card.dataset.activity)?.status??'open';card.hidden=app.downtimeStatusFilter!=='all'&&status!==app.downtimeStatusFilter;if(!card.hidden)visible++;}
      area.querySelector('[data-downtime-count]').textContent=`${visible} of ${cards.length} activities shown`;
      area.querySelector('[data-downtime-empty]').hidden=visible>0;
    };
    filter.addEventListener('change',()=>{app.downtimeStatusFilter=filter.value;applyFilter();});applyFilter();
    const options=selected=>Object.entries(downtimeTypes).map(([key,label])=>`<option value="${key}" ${key===selected?'selected':''}>${esc(label)}</option>`).join('');
    const editRequest=(container,id)=>{
      const activity=value().activities.find(a=>a.id===id),wish=value().requests.find(a=>a.id===id),entry=wish??activity??{title:'',type:'project',description:'',dp:0};
      container.innerHTML=`<form data-request-form><label>Title<input name="title" maxlength="150" value="${esc(entry.title)}" required></label><label>Type<select name="type" ${activity?.invested>0?'disabled':''}>${options(entry.type)}</select></label><label data-training-skill-label hidden>Skill to train<select name="trainingSkill" data-training-skill></select></label><p data-training-help hidden>1 DP grants one training applied to the selected skill. Skills already assigned TP or another Training are excluded. Details only costs 0 DP.</p><label>What are you seeking?<textarea name="description" rows="4" maxlength="10000">${esc(entry.description)}</textarea></label><label>DP requested<input name="dp" type="number" min="0" max="1000000" step="1" value="${wish?.dp??0}" required></label><button type="submit">Keep in draft</button><button type="button" data-cancel-editor>Cancel</button><p data-editor-error></p></form>`;
      const form=container.querySelector('form');
      const updateCost=()=>{if(form.elements.type.value==='training')form.elements.dp.value=form.elements.trainingSkill.value==='details-only'?'0':'1';};
      const prompt=()=>{
        const training=form.elements.type.value==='training';form.elements.description.placeholder=downtimePrompts[form.elements.type.value];
        form.querySelector('[data-training-skill-label]').hidden=!training;form.querySelector('[data-training-help]').hidden=!training;form.elements.dp.readOnly=training;
        if(training){const choices=trainingSkillOptions(state.draft,readPlayerActor(actor,game.user,app.role),id);form.elements.trainingSkill.innerHTML='<option value="">Choose an eligible skill</option><option value="details-only">Update details only (0 DP)</option>'+choices.map(row=>`<option value="${esc(row.id)}">${esc(row.name)} · ${esc(row.categoryLabel)} · Raw ${row.raw}% / Full ${row.effective??'—'}%</option>`).join('');form.elements.trainingSkill.value=wish?.trainingSkill?.itemId??(wish?.dp===0?'details-only':'');updateCost();}
      };prompt();form.elements.type.addEventListener('change',prompt);
      form.elements.trainingSkill.addEventListener('change',()=>{updateCost();const row=readPlayerActor(actor,game.user,app.role).rows.find(row=>row.id===form.elements.trainingSkill.value);if(row&&!form.elements.title.value.trim())form.elements.title.value=`Training: ${row.name}`.slice(0,150);});
      form.querySelector('[data-cancel-editor]').onclick=()=>{container.replaceChildren();};
      form.onsubmit=event=>{
        event.preventDefault();const dp=Number(form.elements.dp.value),title=form.elements.title.value.trim();
        if(!title||!Number.isSafeInteger(dp)||dp<0||dp>1000000){form.querySelector('[data-editor-error]').textContent='Enter a title and a whole, non-negative DP amount.';return;}
        const request={id:id??(globalThis.crypto?.randomUUID?.()??foundry.utils.randomID(32)),title,type:form.elements.type.value,description:form.elements.description.value.trim(),dp,revision:activity?.revision??null};
        if(request.type==='training'&&form.elements.trainingSkill.value!=='details-only') {
          const row=trainingSkillOptions(state.draft,readPlayerActor(actor,game.user,app.role),id).find(row=>row.id===form.elements.trainingSkill.value);
          if(!row||dp!==1){form.querySelector('[data-editor-error]').textContent='Choose an eligible, unassigned Training skill (1 DP).';return;}
          request.trainingSkill={itemId:row.id,name:row.name,start:baseline(row),fullBefore:Number.isFinite(row.effective)?row.effective:null};
        } else if(request.type==='training'&&dp!==0){form.querySelector('[data-editor-error]').textContent='Details-only updates cost 0 DP.';return;}
        const target=store(),index=target.requests.findIndex(a=>a.id===request.id);if(index<0)target.requests.push(request);else target.requests[index]=request;
        state.dirty=true;render();updateSummary();app.updateMarkdownSummary?.();
      };
    };
    area.querySelector('[data-new-activity]').onclick=()=>{app.downtimeStatusFilter='open';filter.value='open';applyFilter();editRequest(area.querySelector('[data-new-editor]'),null);};
    for(const card of area.querySelectorAll('[data-activity]')) {
      const id=card.dataset.activity;
      card.querySelector('[data-propose]').onclick=()=>editRequest(card.querySelector('[data-editor]'),id);
      card.querySelector('[data-withdraw]')?.addEventListener('click',()=>{store().requests=store().requests.filter(a=>a.id!==id);state.dirty=true;render();updateSummary();app.updateMarkdownSummary?.();});
      card.querySelector('[data-dm-details]')?.addEventListener('click',()=>app.editDowntimeDetails(card.querySelector('[data-editor]'),actor,id,state));
      card.querySelector('[data-convert-training]')?.addEventListener('click',()=>app.editTrainingConversion(card.querySelector('[data-editor]'),actor,id,state));
    }
    if(app.role==='gm')for(const card of area.querySelectorAll('[data-activity]'))if(dmDossiers.get(actor.uuid)?.data.downtime?.activities.find(activity=>activity.id===card.dataset.activity)?.completeOnApply) {
    const message=document.createElement('p');message.dataset.completionScheduled='';message.textContent='Completion scheduled: this activity will become Completed when its next request is applied.';
    card.querySelector('h3').after(message);
    }
  };render();
}

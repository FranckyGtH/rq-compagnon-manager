import { attachReferenceManager } from './reference-application.mjs';
import { saveCharacterReference } from './actor-reference.mjs';
import { resumeDMExchange } from './dm-synchronization.mjs';
import { privateDowntime, publishDowntimeActivity, resumeDowntimePublication, trainingConversionPlan, convertTrainingDP } from './downtime-dm.mjs';
import { downtimeStatuses, convertedTrainingDP } from './downtime-rules.mjs';
import { PlayerProgressionApplication } from './player-application.mjs';
import { listActors, escapeHTML } from './core.mjs';
import { progressionPlan, transactionStore, applyProgression } from './apply-progression.mjs';
import { readPlayerActor } from './player-rules.mjs';
import { readReadableDistribution } from './readable-notes.mjs';
import { checkNativeNotesSideEffects, canSaveNotes } from './distribution.mjs';
import { appendExportHistory, progressionMarkdown } from './season-training.mjs';
import { characteristicRows, characteristicPlan, applyCharacteristics, resumeCharacteristics } from './characteristics.mjs';
import { dmDossiers } from './manager-state.mjs';
import { dmPackId, initializeDMPack, checkDMPack, loadDMDossier, migrateDMDossier, saveDMDossier } from './dm-compendium.mjs';

export function requireGM(user=game.user) {
  if(user?.isGM!==true)throw new Error('This interface is restricted to the GM.');
}
export async function exportGMCharacter(actor,user=game.user,phase='Before application') {
  requireGM(user);
  if(!actor||actor.type!=='character'||actor.isToken||actor.isEmbedded||actor.inCompendium)throw new Error('Select a world character before exporting.');
  if(typeof actor.toObject!=='function'||typeof foundry.utils?.saveDataToFile!=='function')throw new Error('JSON export is unavailable for this character.');
  if(!['Before application','After application'].includes(phase))throw new Error('Invalid export phase.');
  if(actor?.flags?.world?.companionManager?.schema===2) {
    await loadDMDossier(actor);checkDMPack(game.packs.get(dmPackId),{write:true});
    const at=new Date().toISOString(),timestamp=at.replaceAll('-','').replaceAll(':','').replace('.',''),name=String(actor.name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'character';
    const filename=`Compagnon-DM-${name}-${actor.id}-${timestamp}.json`,cached=dmDossiers.get(actor.uuid);
    const exports=[...cached.data.exports,{phase,at,filename,dm:user.name??user.id}].slice(-5);
    const dossier=JSON.parse(JSON.stringify(cached.document.toObject(true)));
    dossier.flags.world.companionManagerDM.exports=exports;
    const exportPage=dossier.pages?.find(page=>page.name==='Export history');
    if(exportPage)exportPage.text.content=`<h2>Latest five backup requests</h2>${exports.map(entry=>`<p>${escapeHTML(entry.phase)}<br>${escapeHTML(entry.at)}<br>${escapeHTML(entry.filename)}<br>DM: ${escapeHTML(entry.dm)}</p>`).join('')}`;
    const bundle={format:'CompagnonManagerDMBackup',schema:1,createdAt:at,worldId:game.world?.id,foundryVersion:game.version,systemVersion:game.system.version,actor:actor.toObject(true),compendium:{id:dmPackId,ownership:game.packs.get(dmPackId).ownership},dossier};
    await foundry.utils.saveDataToFile(JSON.stringify(bundle,null,2),'application/json',filename);
    try{await saveDMDossier(actor,{exports});}catch(error){throw new Error(`Backup requested: ${filename}. Private export log failed: ${error.message}`);}
    try{await saveCharacterReference(actor,'DM export');}catch(error){ui.notifications.warn('JSON backup requested; the existing compendium reference was preserved: '+error.message);}
    return filename;
  }
  if(!actor||actor.type!=='character'||actor.isToken||actor.isEmbedded||actor.inCompendium)throw new Error('Select a world character before exporting.');
  if(typeof actor.toObject!=='function'||typeof foundry.utils?.saveDataToFile!=='function')throw new Error('JSON export is unavailable for this character.');
  if(!['Before application','After application'].includes(phase))throw new Error('Invalid export phase.');
  if(!canSaveNotes(actor,user,'gm')||typeof actor.system?.background?.biography!=='string')throw new Error('Export history cannot be saved to this character.');
  checkNativeNotesSideEffects(actor);
  const data=JSON.parse(JSON.stringify(actor.toObject(true)));
  data._stats??={};
  data._stats.exportSource={worldId:game.world?.id,uuid:actor.uuid,coreVersion:game.version,systemId:game.system.id,systemVersion:game.system.version};
  const at=new Date().toISOString();
  const timestamp=at.replaceAll('-','').replaceAll(':','').replace('.','');
  const name=String(actor.name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'character';
  const filename=`fvtt-Actor-${name}-${actor.id}-${timestamp}.json`;
  const entry=`<p><strong>${escapeHTML(phase)}</strong><br>Export requested (UTC): ${escapeHTML(at)}<br>File: ${escapeHTML(filename)}<br>DM: ${escapeHTML(user.name??user.id)}</p>`;
  const append=html=>appendExportHistory(html,entry);
  // Include this reference in the downloaded snapshot too. The browser controls
  // the final download; record a request, never claim a verified local save.
  data.system.background.biography=append(data.system.background.biography);
  await foundry.utils.saveDataToFile(JSON.stringify(data,null,2),'application/json',filename);
  try {
    requireGM(user);requireGM();checkNativeNotesSideEffects(actor);
    const next=append(actor.system.background.biography);
    const saved=await actor.update({'system.background.biography':next});
    if(!saved||actor.system.background.biography!==next)throw new Error('Notes update could not be verified.');
  } catch(error) {throw new Error(`Export requested: ${filename}. Its reference could not be recorded in the notes: ${error.message}`);}
  return filename;
}
export class GMProgressionApplication extends PlayerProgressionApplication {
  constructor(options={}) {
    requireGM();
    super({...options,role:'gm'});
    this.exportAfter=false;
    this.lastExports=new Map();
    this.screen='summary';
  }
  get title() { return 'RQ compagnon Manager DM · v0.17.3'; }
  loadState(snapshot) {
    requireGM();
    super.loadState(snapshot);
  }
  async _prepareContext(options) {
    requireGM();
    this.dossierError=null;
    const candidates=listActors(game.actors,game.user,'gm');
    const actor=game.actors.get(candidates.some(row=>row.id===this.actorId)?this.actorId:candidates[0]?.id);
    if(actor?.flags?.world?.companionManager?.schema===2)try{await loadDMDossier(actor);}catch(error){dmDossiers.delete(actor.uuid);this.dossierError=error.message;}
    return super._prepareContext(options);
  }
  async _renderHTML(context) {
    requireGM();
    const root=await super._renderHTML(context);
    root.querySelector('.kp-intro p').textContent='Review player requests or prepare a distribution';
    root.querySelector('.kp-badge').textContent='GM · Preparation';
    root.querySelector('footer').textContent='v0.17.3 · DM synchronization publishes budgets and results; PCs save requests only. Apply updates progression, then clears points and wishes after verification.';
    const save=root.querySelector('[data-save]');
    if(save)save.textContent='Save / synchronize DM publication';
    const reload=root.querySelector('[data-reload]');
    if(reload)reload.textContent='Load saved request (discard draft)';
    const button=document.createElement('button');
    button.type='button';button.dataset.export='';button.textContent='Export DM backup (JSON)';
    button.disabled=!context.snapshot;
    button.title='Back up the saved character, including its saved request notes. Unsaved changes in this window are not included.';
    root.querySelector('.kp-selection').append(button);
    const exportInfo=document.createElement('p');exportInfo.className='kp-help';
    exportInfo.textContent='DM backup includes the saved character and its complete private dossier. Save requests first to include them.';
    root.querySelector('.kp-selection').after(exportInfo);
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try {
        requireGM();
        const actor=game.actors.get(this.actorId);
        if(!listActors(game.actors,game.user,'gm').some(candidate=>candidate.id===actor?.id))throw new Error('This character is no longer accessible.');
        if(!this.dossierReady||actor.flags?.world?.companionManager?.schema!==2)throw new Error('Initialize / migrate the character dossier in Summary first.');
        const filename=await exportGMCharacter(actor,game.user);
        this.lastExports.set(actor.uuid,{filename,at:new Date().toISOString()});
        ui.notifications.info(`JSON export requested for ${actor.name}. Check your browser downloads.`);
      } catch(error) {ui.notifications.error(error.message);}
      finally {button.disabled=!this.actorId||game.user?.isGM!==true;}
    });
    if(context.snapshot) {
      const actor=game.actors.get(context.snapshot.id),active=transactionStore(actor).active;
      if(this.states.get(actor.id)?.error){const panel=root.querySelector('.kp-player-panel');const nav=document.createElement('div');nav.className='kp-screen-nav';const summary=document.createElement('section');summary.dataset.screen='summary';summary.className='kp-screen';nav.innerHTML='<button type="button" data-screen-tab="summary">Summary</button>';panel.prepend(nav,summary);this.screen='summary';}
      this.attachCharacteristics(root,actor,context.snapshot);
      this.attachManagerSummary(root,actor);
      const actions=document.createElement('div');actions.className='kp-dm-update';
      actions.innerHTML=`<button type="button" data-apply>${active?'Resume interrupted update':'Apply progression to sheet'}</button><label><input type="checkbox" data-export-after ${this.exportAfter?'checked':''}> Export after update</label><p data-apply-status></p>`;
      root.querySelector('footer').before(actions);
      actions.querySelector('[data-export-after]').addEventListener('change',event=>{this.exportAfter=event.target.checked;});
      actions.querySelector('[data-apply]').addEventListener('click',async()=>{
        const controls=[...root.querySelectorAll('input,select,button')],disabled=controls.map(control=>control.disabled);
        controls.forEach(control=>{control.disabled=true;});
        try {
          requireGM();
          if(!this.dossierReady||actor.flags?.world?.companionManager?.schema!==2)throw new Error('Initialize / migrate the character dossier in Summary first.');
          const state=this.states.get(actor.id),pending=transactionStore(actor).active;
          if(this.downtimeEditor?.dirty)throw new Error('Save private downtime details first.');
          if(state.dirty)throw new Error('Save the distribution, or reload the saved request, before applying progression.');
          const plan=pending?.plan??progressionPlan(actor);
          const lastExport=this.lastExports.get(actor.uuid);
          const confirmed=await foundry.applications.api.DialogV2.confirm({
            window:{title:pending?'Resume character update':'Apply character progression'},
            content:`<p><strong>Have you exported a backup of ${escapeHTML(actor.name)} before this update?</strong></p><p>${lastExport?`Last export requested in this window: ${escapeHTML(lastExport.filename)}. Check that the file was downloaded.`:'No export has been requested in this window. Cancel and use Export character (JSON) if needed.'}</p><p>${plan.changes.length} entries and ${(plan.statChanges??[]).reduce((sum,change)=>sum+change.after.ticks-change.before.ticks,0)} characteristic ticks will be checked/updated. Allocated: XP ${plan.balances.used.xp}, TP ${plan.balances.used.tp}, DP ${plan.balances.used.dp}.</p><p><strong>Unused points: XP ${plan.balances.remaining.xp}, TP ${plan.balances.remaining.tp}, DP ${plan.balances.remaining.dp}.</strong> All three budgets will be reset to zero after success; unused points are archived, not carried over. Downtime investments will be applied and retained in the activity history.</p><p>The saved wishes and seasonal rewards will be cleared only after verification. ${this.exportAfter?'A timestamped export will be requested after success.':''}</p>`,
            yes:{label:pending?'Resume update':'Apply update',icon:'fas fa-check'},
            no:{label:'Cancel',icon:'fas fa-times',default:true}
          });
          if(confirmed!==true)return;
          await applyProgression(actor,game.user,plan.fingerprint);
          ui.notifications.info('Progression and downtime applied and verified. All activities saved in the DM compendium. Points and wishes cleared.');
          this.loadState(readPlayerActor(actor,game.user,'gm'));
          if(this.exportAfter) {
            try{const filename=await exportGMCharacter(actor,game.user,'After application');this.lastExports.set(actor.uuid,{filename,at:new Date().toISOString()});ui.notifications.info('Post-update export requested. Check your browser downloads.');}
            catch(error){ui.notifications.error(`Update completed; post-update export failed: ${error.message}. Use Export character (JSON).`);}
          }
          await this.refresh();
        } catch(error) {
          ui.notifications.error(error.message);
          actions.querySelector('[data-apply-status]').textContent=error.message;
          if(transactionStore(actor).active)actions.querySelector('[data-apply]').textContent='Resume interrupted update';
        } finally {controls.forEach((control,index)=>{control.disabled=disabled[index];});}
      });
    }
    return root;
  }
  editTrainingConversion(container,actor,id,state) {
    try {
      requireGM();
      if(!this.dossierReady)throw new Error('Initialize the dossier in Summary first.');
      if(this.downtimeEditor?.dirty)throw new Error('Save private downtime details first.');
      if(state.dirty)throw new Error('Save or reload the distribution before converting Training.');
      const activity=privateDowntime(actor).activities.find(item=>item.id===id),remaining=activity.invested-convertedTrainingDP(activity);
      trainingConversionPlan(actor,id,remaining);
      container.innerHTML=`<form data-training-conversion-form><p>1 invested DP = 1 TP. Converted DP remain recorded as invested progress and cannot be converted again.</p><label>DP to convert<input name="dp" type="number" min="1" max="${remaining}" step="1" value="${remaining}" required></label><button type="submit">Review conversion</button><button type="button" data-cancel-conversion>Cancel</button><p data-conversion-error></p></form>`;
      const form=container.querySelector('form');form.querySelector('[data-cancel-conversion]').onclick=()=>container.replaceChildren();
      form.onsubmit=async event=>{
        event.preventDefault();const controls=[...this.element.querySelectorAll('input,select,button')],disabled=controls.map(control=>control.disabled);
        try {
          requireGM();if(state.dirty||this.downtimeEditor?.dirty)throw new Error('Save or reload pending edits before conversion.');
          const dp=Number(form.elements.dp.value),plan=trainingConversionPlan(actor,id,dp);controls.forEach(control=>control.disabled=true);
          const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Convert Training DP to TP'},content:`<p><strong>${escapeHTML(plan.title)}</strong>: convert ${dp} invested DP into ${dp} TP?</p><p>Base TP assigned: ${plan.beforeTP} → ${plan.afterTP}. Seasonal TP bonuses are kept. ${plan.available-dp} invested DP remain unconverted.</p><p>DP invested are kept in the activity history. No skill or characteristic value changes. The player must reload notes to use the newly assigned TP.</p>`,yes:{label:'Convert / publish TP'},no:{label:'Cancel',default:true}});
          if(confirmed!==true)return;
          await convertTrainingDP(actor,id,dp,plan);
          this.loadState(readPlayerActor(actor,game.user,'gm'));await this.refresh();
          ui.notifications.info(`${dp} DP converted to ${dp} TP. Reload PC notes before allocating them.`);
        }catch(error){form.querySelector('[data-conversion-error]').textContent=error.message;ui.notifications.error(error.message);if(dmDossiers.get(actor.uuid)?.data.downtimePending||actor.flags?.world?.companionManager?.active){this.screen='summary';await this.refresh();}}
        finally{controls.forEach((control,index)=>control.disabled=disabled[index]);}
      };
    }catch(error){ui.notifications.error(error.message);}
  }
  editDowntimeDetails(container,actor,id,state) {
    try {
      requireGM();
      if(!this.dossierReady)throw new Error('Initialize the dossier in Summary first.');
      if(this.downtimeEditor?.dirty)throw new Error('Save private downtime details first.');
          if(state.dirty)throw new Error('Save the request before editing private activity details.');
      const activity=privateDowntime(actor).activities.find(a=>a.id===id),wish=state.draft.downtime?.requests.find(a=>a.id===id),base=activity??wish;
      if(!base)throw new Error('Reload the saved activity first.');
      container.innerHTML=`<form data-dm-activity-form><label>DP required (blank = not set)<input name="required" type="number" min="${activity?.invested??0}" max="1000000" step="1" value="${activity?.required??''}"></label><label><input name="showRequired" type="checkbox" ${activity?.showRequired?'checked':''}> Show required DP to player</label><label>Published DM response<textarea name="response" rows="4" maxlength="10000">${escapeHTML(activity?.response??'')}</textarea></label><label>Secret DM notes<textarea name="secret" rows="4" maxlength="10000">${escapeHTML(activity?.secret??'')}</textarea></label><label>Status<select name="status">${Object.entries(downtimeStatuses).map(([key,label])=>`<option value="${key}" ${(activity?.status??'open')===key?'selected':''}>${escapeHTML(key==='complete'&&wish?'Completed (after applying pending request)':label)}</option>`).join('')}</select></label><label><input name="completeOnApply" type="checkbox" ${activity?.completeOnApply?'checked':''}> Complete when progression is applied</label><p class="kp-help">With a pending request, Completed schedules closure after applying its DP and Training. Without a pending request, Completed closes the activity immediately. The checkbox can schedule closure on the next request for this activity.</p><button type="submit">Save details / publish response</button><button type="button" data-close-dm-editor>Close</button><p data-dm-activity-error></p></form>`;
      const form=container.querySelector('form');
      const completionChoice=()=>{
        const status=form.elements.status.value,checkbox=form.elements.completeOnApply;
        checkbox.disabled=status!=='open';
        if(status==='complete'&&wish)checkbox.checked=true;
        else if(status!=='open')checkbox.checked=false;
      };completionChoice();form.elements.status.addEventListener('change',completionChoice);
      const appControls=[...this.element.querySelectorAll('button,input,select')],previousDisabled=appControls.map(c=>c.disabled);
      this.downtimeEditor={actorId:actor.id,dirty:false};
      form.oninput=()=>{this.downtimeEditor.dirty=true;for(const control of appControls)if(!form.contains(control))control.disabled=true;};
      form.querySelector('[data-close-dm-editor]').onclick=async()=>{if(this.downtimeEditor.dirty&&await foundry.applications.api.DialogV2.confirm({window:{title:'Discard private activity edits'},content:'<p>Discard the unsaved private details in this editor?</p>',yes:{label:'Discard'},no:{label:'Keep editing',default:true}})!==true)return;appControls.forEach((c,i)=>c.disabled=previousDisabled[i]);this.downtimeEditor=null;container.replaceChildren();};
      form.onsubmit=async event=>{
        event.preventDefault();const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
        try {
          if(state.dirty)throw new Error('Save or reload the distribution before publishing.');
          await publishDowntimeActivity(actor,id,{required:form.elements.required.value===''?null:Number(form.elements.required.value),showRequired:form.elements.showRequired.checked,response:form.elements.response.value.trim(),secret:form.elements.secret.value.trim(),status:form.elements.status.value,completeOnApply:form.elements.completeOnApply.checked},state.fingerprint);
          const scheduled=privateDowntime(actor).activities.find(activity=>activity.id===id)?.completeOnApply;
          this.downtimeEditor=null;this.loadState(readPlayerActor(actor,game.user,'gm'));await this.refresh();ui.notifications.info(scheduled?'Details saved. Activity will complete when its next request is applied.':'Activity details saved. Public response published; secret notes remain in the DM dossier.');
        }catch(error){form.querySelector('[data-dm-activity-error]').textContent=error.message;ui.notifications.error(error.message);buttons.forEach(b=>b.disabled=false);}
      };
    }catch(error){ui.notifications.error(error.message);}
  }
  attachManagerSummary(root,actor) {
    const summary=root.querySelector('[data-screen=summary]');if(!summary)return;
    const cached=dmDossiers.get(actor.uuid),linked=actor.flags?.world?.companionManager?.schema===2,ready=linked&&cached&&!this.dossierError&&Object.keys(actor.flags.world.companionManager).every(key=>['schema','dossier','active'].includes(key));
    const management=document.createElement('div');management.className='kp-manager-admin';
    management.innerHTML=`<h3>Manager administration</h3><p>${this.dossierError?escapeHTML(this.dossierError):ready?`Private dossier ready for ${escapeHTML(actor.name)}.`:'Initialize the DM compendium and migrate this character before using the manager.'}</p><div class="kp-actions"><button type="button" data-initialize-dossier>Initialize / migrate character</button><button type="button" data-repair-pack>Repair permissions / unlock</button><button type="button" data-open-pack>Open DM compendium</button><button type="button" data-open-dossier ${ready?'':'disabled'}>Open character dossier</button><button type="button" data-reload-dossier ${linked?'':'disabled'}>Reload dossier</button>${cached?.data.synchronizationPending?'<button type="button" data-resume-sync>Recover DM synchronization</button>':''}${cached&&(cached.data.downtimePending||(actor.flags?.world?.companionManager?.active&&!cached.data.progression.active&&!cached.data.characteristicPending&&!cached.data.synchronizationPending))?'<button type="button" data-resume-downtime>Recover publication / release lock</button>':''}${cached?.data.characteristicPending?'<button type="button" data-resume-characteristics>Recover characteristic update</button>':''}</div><p class="kp-help">One journal per character. Private pages: Identity, Characteristic ticks, Progression history, Export history, Downtime — Active / Completed / Failed, Downtime — DM, Private notes, Migration archive. Generated tracking pages are maintained by the manager; edit private downtime and notes in the dossier.</p>`;
    summary.prepend(management);
    const execute=async operation=>{
      const buttons=[...root.querySelectorAll('button')],disabled=buttons.map(button=>button.disabled);buttons.forEach(button=>{button.disabled=true;});
      try{requireGM();if(this.states.get(actor.id)?.dirty)throw new Error('Save or reload the current distribution before managing its dossier.');await operation();await this.refresh();}
      catch(error){ui.notifications.error(error.message);management.querySelector('p').textContent=error.message;}
      finally{buttons.forEach((button,index)=>{button.disabled=disabled[index];});}
    };
    management.querySelector('[data-initialize-dossier]').addEventListener('click',()=>execute(async()=>{await initializeDMPack();await migrateDMDossier(actor);this.loadState(readPlayerActor(actor,game.user,'gm'));ui.notifications.info('Private dossier verified; shared character cleaned.');}));
    management.querySelector('[data-repair-pack]').addEventListener('click',()=>execute(initializeDMPack));
    management.querySelector('[data-open-pack]').addEventListener('click',()=>execute(async()=>checkDMPack(game.packs?.get(dmPackId)).render(true)));
    management.querySelector('[data-open-dossier]').addEventListener('click',()=>execute(async()=>{const document=await loadDMDossier(actor);await document.sheet.render({force:true});}));
    management.querySelector('[data-reload-dossier]').addEventListener('click',()=>execute(async()=>{await loadDMDossier(actor);this.loadState(readPlayerActor(actor,game.user,'gm'));}));
    management.querySelector('[data-resume-sync]')?.addEventListener('click',()=>execute(async()=>{await resumeDMExchange(actor);this.loadState(readPlayerActor(actor,game.user,'gm'));}));
    management.querySelector('[data-resume-downtime]')?.addEventListener('click',()=>execute(async()=>{await resumeDowntimePublication(actor);this.loadState(readPlayerActor(actor,game.user,'gm'));}));
    management.querySelector('[data-resume-characteristics]')?.addEventListener('click',()=>execute(async()=>{await resumeCharacteristics(actor);this.loadState(readPlayerActor(actor,game.user,'gm'));}));
    // Compendium storage is mandatory for native operations in the current UI.
    if(!ready)for(const control of root.querySelectorAll('[data-save],[data-export],[data-save-training-settings],[data-initial-dex],[data-species-maximum],[data-save-characteristic-ticks],[data-collect-characteristic-ticks],[data-apply-characteristics]'))control.disabled=true;
    this.dossierReady=Boolean(ready);attachReferenceManager(this,summary,actor,Boolean(ready));
    const nav=root.querySelector('.kp-screen-nav');
    for(const id of ['summary','characteristics','progression','training','downtime']){const tab=nav.querySelector(`[data-screen-tab="${id}"]`);if(tab)nav.append(tab);}
  }
  attachCharacteristics(root,actor,snapshot) {
    const state=this.states.get(actor.id);
    if(state.error)return;
    const panel=root.querySelector('.kp-player-panel'),nav=panel.querySelector('.kp-screen-nav');
    const screen=document.createElement('section');screen.className='kp-screen';screen.dataset.screen='characteristics';
    screen.innerHTML=`<div class="kp-training-settings"><label>Initial DEX<input data-initial-dex type="number" min="1" max="1000" step="1" value="${state.draft.training.initialDex??''}"></label><label>Species maximum<input data-species-maximum type="number" min="1" max="1000" step="1" value="${state.draft.training.speciesMaximum??''}"></label><button type="button" data-save-training-settings>Save settings / DM publication</button></div><div data-characteristic-body></div>`;
    panel.insertBefore(screen,panel.querySelector('[data-state]'));
    for(const button of nav.children)button.addEventListener('click',()=>{screen.hidden=true;});
    const tab=document.createElement('button');tab.type='button';tab.dataset.screenTab='characteristics';tab.textContent='Characteristics';nav.append(tab);
    const display=()=>{for(const section of panel.querySelectorAll('[data-screen]'))section.hidden=section.dataset.screen!==(this.screen??'progression');for(const button of nav.children)button.setAttribute('aria-pressed',String(button.dataset.screenTab===(this.screen??'progression')));};
    tab.addEventListener('click',()=>{this.screen='characteristics';render();display();});
    const rule='table21';
    const render=()=>{
      const entered=new Map([...screen.querySelectorAll('[data-force-ticks]')].map(input=>[input.dataset.forceTicks,input.value]));
      const fresh=readPlayerActor(actor,game.user,'gm'),rows=characteristicRows(fresh,state.draft.training,rule);
      screen.querySelector('[data-characteristic-body]').innerHTML=`<h3>Characteristics</h3><div class="kp-actions"><button type="button" data-collect-characteristic-ticks ${rows.some(row=>row.checked)?'':'disabled'}>Collect Experience ticks</button></div><p>DM only. Each application increases eligible characteristics by one point and spends the displayed ticks. Repeat after reviewing the new costs to increase them again.</p>
        <p>Experience toggles represent newly earned ticks. Collect checked toggles to add one tick each and clear them. Accumulated ticks, forced counts and seasonal rewards do not create Experience toggles.</p>
        <p>Tick cost (+1): current value ≤9: 1 · 10–15: 2 · 16–17: 3 · 18–19: 4 · 20: 5.</p>
        <p class="kp-help">This table applies to a species maximum of 21. Save the settings above before updating characteristics. INT and SIZ are displayed for reference and cannot be increased by training.</p>
        <div class="kp-characteristics-table"><table><thead><tr><th>Characteristic</th><th>Current</th><th>Maximum</th><th>Ticks</th><th>Experience</th><th>Force ticks</th><th>Cost +1</th><th>After application</th></tr></thead><tbody>${rows.map(row=>`<tr data-characteristic="${row.key}"><td>${row.label}</td><td>${row.value??'—'}</td><td>${row.maximum??'—'}${['intelligence','size'].includes(row.key)?' (no training)':''}</td><td>${row.ticks}</td><td data-characteristic-experience>${row.checked?'✓':'—'}</td><td><input type="number" min="0" max="1000000" step="1" data-force-ticks="${row.key}" placeholder="Unchanged" aria-label="Force ${row.label} ticks"></td><td>${row.cost??'—'}</td><td>${row.eligible?`${row.value+1} · ${row.ticks-row.cost} ticks left`:escapeHTML(row.reason||'Not enough ticks')}</td></tr>`).join('')}</tbody></table></div>
        <div class="kp-actions"><button type="button" data-save-characteristic-ticks>Save forced ticks</button><button type="button" data-apply-characteristics ${rows.some(row=>row.eligible)?'':'disabled'}>Apply characteristic increases</button></div><p data-characteristic-status></p>`;
      for(const input of screen.querySelectorAll('[data-force-ticks]'))input.value=entered.get(input.dataset.forceTicks)??'';
      const run=async mode=>{
        const controls=[...root.querySelectorAll('input,select,button')],disabled=controls.map(control=>control.disabled);
        try {
          requireGM();
          if(!this.dossierReady||actor.flags?.world?.companionManager?.schema!==2)throw new Error('Initialize / migrate the character dossier in Summary first.');
          if(this.downtimeEditor?.dirty)throw new Error('Save private downtime details first.');
          if(state.dirty)throw new Error('Save the distribution or reload the notes before changing characteristics.');
          const inputs=[...screen.querySelectorAll('[data-force-ticks]')],forced={};
          if(mode!=='force'&&inputs.some(input=>input.value!==''))throw new Error('Save or clear the forced tick fields before collecting ticks or applying increases.');
          if(mode==='force')for(const input of inputs)if(input.value!=='')forced[input.dataset.forceTicks]=Number(input.value);
          const options={mode,forced,rule},plan=characteristicPlan(actor,options);
          controls.forEach(control=>{control.disabled=true;});
          const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:mode==='collect'?'Collect characteristic Experience ticks':mode==='increase'?'Apply characteristic increases':'Set characteristic tick counters'},content:`<p><strong>Have you exported a backup of ${escapeHTML(actor.name)}?</strong></p><ul>${plan.changes.map(change=>`<li>${change.label}: ${change.before.value} → ${change.after.value}; ticks ${change.before.ticks} → ${change.after.ticks}${change.spent?` (${change.spent} spent)`:''}${mode==='collect'?'; Experience toggle cleared':''}</li>`).join('')}</ul><p>Rule: ${escapeHTML(rule??'not selected')}. ${mode==='collect'?'One new tick per checked Experience toggle; those toggles will be cleared.':mode==='increase'?'One point per eligible characteristic.':'Entered counts replace existing counts; blank fields stay unchanged.'} ${this.exportAfter?'Export after update is enabled.':''}</p>`,yes:{label:'Apply',icon:'fas fa-check'},no:{label:'Cancel',default:true}});
          if(confirmed!==true)return;
          await applyCharacteristics(actor,options,game.user,plan);
          this.loadState(readPlayerActor(actor,game.user,'gm'));
          if(this.exportAfter)try {const filename=await exportGMCharacter(actor,game.user,'After application');this.lastExports.set(actor.uuid,{filename,at:new Date().toISOString()});}catch(error){ui.notifications.error(`Characteristics saved; export failed: ${error.message}`);}
          ui.notifications.info(mode==='collect'?'Experience ticks collected and toggles cleared.':mode==='increase'?'Characteristics increased and ticks spent.':'Characteristic tick counters saved.');
          await this.refresh();
        } catch(error){ui.notifications.error(error.message);screen.querySelector('[data-characteristic-status]').textContent=error.message;}
        finally {controls.forEach((control,index)=>{control.disabled=disabled[index];});}
      };
      screen.querySelector('[data-save-characteristic-ticks]').addEventListener('click',()=>run('force'));
      screen.querySelector('[data-collect-characteristic-ticks]').addEventListener('click',()=>run('collect'));
      screen.querySelector('[data-apply-characteristics]').addEventListener('click',()=>run('increase'));
    };
    for(const [selector,key]of [['[data-initial-dex]','initialDex'],['[data-species-maximum]','speciesMaximum']])screen.querySelector(selector).addEventListener('input',event=>{
      state.draft.training[key]=event.target.value===''?null:Number(event.target.value);state.dirty=true;
      render();this.renderSeasonTraining?.();this.updateDistributionSummary?.();
    });
    screen.querySelector('[data-save-training-settings]').addEventListener('click',()=>root.querySelector('[data-save]').click());
    render();display();
  }
}

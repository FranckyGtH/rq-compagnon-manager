import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { englishSource } from '../english-source.mjs';
async function setupTargetedTraining(page,{normalTP=0,xp=false}={}) {
  await setupDowntime(page);
  await page.evaluate(async({normalTP,xp})=>{
    const snapshot=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot),row=snapshot.rows.find(row=>row.id==='dance');
    loaded.draft.amounts={xp:xp?1:0,tp:normalTP,dp:2};loaded.draft.entries=xp?[{itemId:'dance',name:row.name,type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(row)}]:[];
    loaded.draft.downtime.requests=[{id:'target1',title:'Practice Dance',type:'training',description:'Practice with a teacher.',dp:1,revision:null,trainingSkill:{itemId:row.id,name:row.name,start:api.baseline(row),fullBefore:row.effective}}];
    await api.saveReadableDistribution(actor,game.user,'gm',loaded.draft,loaded.fingerprint);
  },{normalTP,xp});
}

test('targeted Training applies DP investment and skill training in one distribution without granting a second TP budget',async()=>fixture(async page=>{
  await setupTargetedTraining(page,{xp:true});
  const result=await page.evaluate(async()=>{
    const snapshot=api.readPlayerActor(actor,game.user,'gm'),saved=api.readReadableDistribution(actor.system.background.biography,snapshot),expected=api.projectedValues(saved.draft,snapshot).get('dance');
    const normalBefore=actor.items.find(item=>item.id==='dance').system.chance,tx=await api.applyProgression(actor),after=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),activity=api.privateDowntime(actor).activities[0];
    let doubleBlocked=false;try{await api.convertTrainingDP(actor,'target1',1);}catch{doubleBlocked=true;}
    return {expected,normalBefore,native:actor.items.find(item=>item.id==='dance').system.chance,raw:actor.items.find(item=>item.id==='dance').system.baseChance+actor.items.find(item=>item.id==='dance').system.gainedChance,xp:tx.plan.balances.used.xp,tp:tx.plan.balances.used.tp,dp:tx.plan.balances.used.dp,amounts:after.draft.amounts,wishes:after.draft.downtime.requests.length,invested:activity.invested,converted:api.convertedTrainingDP(activity),target:activity.history.find(event=>event.skill)?.skill.id,summary:tx.plan.markdownSummary,doubleBlocked};
  });
  assert.equal(result.native,result.expected.full);assert.equal(result.raw,result.expected.raw);assert.ok(result.native>result.normalBefore);assert.equal(result.xp,1);assert.equal(result.tp,0);assert.equal(result.dp,1);assert.deepEqual(result.amounts,{xp:0,tp:0,dp:0});assert.equal(result.wishes,0);assert.equal(result.invested,1);assert.equal(result.converted,1);assert.equal(result.target,'dance');assert.equal(result.doubleBlocked,true);assert.match(result.summary,/1 DPs → 1 TPs \(applied to Dance\)/);
},true));

test('targeted Training excludes regular TP and duplicate DP selections and rejects invalid or changed targets',async()=>fixture(async page=>{
  await setupTargetedTraining(page,{normalTP:1});
  const result=await page.evaluate(()=>{
    const snapshot=api.readPlayerActor(actor,game.user,'gm'),saved=api.readReadableDistribution(actor.system.background.biography,snapshot),original=saved.draft,failures=[];
    for(const edit of [draft=>draft.entries.push({itemId:'dance',name:'Dance',type:'skill',xp:0,tp:1,direction:'add',start:api.baseline(snapshot.rows.find(row=>row.id==='dance'))}),draft=>draft.downtime.requests.push({...structuredClone(draft.downtime.requests[0]),id:'duplicate'}),draft=>draft.downtime.requests[0].dp=2,draft=>draft.downtime.requests[0].trainingSkill.itemId='air',draft=>draft.downtime.requests[0].trainingSkill.start.raw++,draft=>draft.downtime.requests[0].trainingSkill.fullBefore++,draft=>draft.downtime.requests[0].trainingSkill.itemId='spirit']){const copy=structuredClone(original);edit(copy);try{api.validatePlayerDraft(copy,snapshot);failures.push(false);}catch{failures.push(true);}}
    const eligible=api.trainingSkillOptions(original,snapshot).map(row=>row.id),own=api.trainingSkillOptions(original,snapshot,'target1').map(row=>row.id);
    actor.items.find(item=>item.id==='dance').system.gainedChance++;let changed=false;try{api.progressionPlan(actor);}catch{changed=true;}
    return {failures,eligible,own,changed};
  });assert.deepEqual(result.failures,Array(7).fill(true));assert.deepEqual(result.eligible,['scan']);assert.deepEqual(result.own,['dance','scan']);assert.equal(result.changed,true);
},true));

test('PC chooses an eligible Training skill, reserves TP checkbox and saves only requests before one DM application',async()=>fixture(async page=>{
  await setupDowntime(page);
  await page.evaluate(async()=>{
    const snapshot=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot);loaded.draft.amounts={xp:0,tp:1,dp:2};loaded.draft.downtime.requests=[];
    loaded.draft.entries=[{itemId:'scan',name:'Scan',type:'skill',xp:0,tp:1,direction:'add',start:api.baseline(snapshot.rows.find(row=>row.id==='scan'))}];
    await api.saveReadableDistribution(actor,game.user,'gm',loaded.draft,loaded.fingerprint);game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});app.screen='downtime';await app.render();globalThis.targetNativeBefore=JSON.stringify(actor.items);globalThis.targetPrivateWrites=dossierWrites;
  });
  await page.locator('[data-new-activity]').click();await page.locator('[data-request-form] select[name=type]').selectOption('training');
  assert.deepEqual(await page.locator('[data-training-skill] option').evaluateAll(options=>options.filter(option=>!['','details-only'].includes(option.value)).map(option=>option.value)),['dance']);
  await page.locator('[data-training-skill]').selectOption('dance');assert.equal(await page.locator('[data-request-form] input[name=dp]').inputValue(),'1');
  await page.locator('[data-request-form] button[type=submit]').click();assert.match(await page.locator('[data-training-target]').innerText(),/Dance.*New full/);
  await page.locator('[data-new-activity]').click();await page.locator('[data-request-form] select[name=type]').selectOption('training');assert.equal(await page.locator('[data-training-skill] option[value=dance]').count(),0);await page.locator('[data-cancel-editor]').click();
  await page.locator('[data-screen-tab=progression]').click();await page.locator('[data-add=dance]').click();assert.equal(await page.locator('[data-entry=dance] [data-allocate=tp]').isDisabled(),true);
  await page.locator('[data-save]').click();await page.waitForFunction(()=>!app.states.get('a').dirty);
  assert.equal(await page.evaluate(()=>JSON.stringify(actor.items)===targetNativeBefore&&dossierWrites===targetPrivateWrites),true);
  await page.locator('[data-screen-tab=downtime]').click();await page.locator('[data-propose]').click();assert.equal(await page.locator('[data-training-skill]').inputValue(),'dance');await page.locator('[data-cancel-editor]').click();
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;} ${css}`});await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:1100px;width:1100px;padding:16px;box-sizing:border-box';});await page.screenshot({path:'analysis/Compagnon_Manager_PC_v0160_target.png',fullPage:true});
  const result=await page.evaluate(async()=>{game.user={id:'gm',isGM:true};await api.applyProgression(actor);const loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));return {cleared:loaded.draft.downtime.requests.length,converted:loaded.draft.downtime.activities[0].convertedDP,phaseEligible:api.trainingSkillOptions(loaded.draft,api.readPlayerActor(actor,game.user,'gm')).some(row=>row.id==='dance')};});assert.deepEqual(result,{cleared:0,converted:1,phaseEligible:true});
},true));

test('targeted Training recovery after native writes or private investment failure never trains or invests twice',async()=>{
  for(const stage of ['native','private','cleanup'])await fixture(async page=>{
    await setupTargetedTraining(page);
    const result=await page.evaluate(async stage=>{
      const snapshot=api.readPlayerActor(actor,game.user,'gm'),saved=api.readReadableDistribution(actor.system.background.biography,snapshot),expected=api.projectedValues(saved.draft,snapshot).get('dance').full;
      const native=actor.updateEmbeddedDocuments.bind(actor),update=actor.update.bind(actor),document=api.dmDossiers.get(actor.uuid).document,save=document.update.bind(document);let failed=false;
      actor.updateEmbeddedDocuments=async(...args)=>{const result=await native(...args);if(stage==='native'&&!failed){failed=true;throw new Error('Interrupted after native skill write');}return result;};
      document.update=async patch=>{if(stage==='private'&&!failed&&patch['flags.world.companionManagerDM']?.downtime.activities.some(activity=>activity.history.some(event=>event.skill))){failed=true;throw new Error('Interrupted private Training investment');}return save(patch);};
      actor.update=async patch=>{if(stage==='cleanup'&&!failed&&patch['system.background.biography']){failed=true;throw new Error('Interrupted request cleanup');}return update(patch);};
      let interrupted=false;try{await api.applyProgression(actor);}catch{interrupted=true;}await api.applyProgression(actor);
      const activity=api.privateDowntime(actor).activities[0],after=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
      return {interrupted,expected,full:actor.items.find(item=>item.id==='dance').system.chance,invested:activity.invested,converted:api.convertedTrainingDP(activity),events:activity.history.filter(event=>event.skill).length,remaining:after.draft.downtime.requests.length};
    },stage);assert.equal(result.interrupted,true);assert.equal(result.full,result.expected);assert.equal(result.invested,1);assert.equal(result.converted,1);assert.equal(result.events,1);assert.equal(result.remaining,0);
  },true);
});

test('targeted Training supports combat packs with one DP and clears every member tick',async()=>fixture(async page=>{
  await combatFixture(page);await prepareApplyFixture(page);
  await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);const snapshot=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot),row=snapshot.rows.find(row=>row.id==='fyrd');
    loaded.draft.amounts={xp:0,tp:0,dp:1};loaded.draft.entries=[];loaded.draft.downtime={activities:[],requests:[{id:'train-style',title:'Train Fyrdman',type:'training',description:'Practice the style.',dp:1,revision:null,trainingSkill:{itemId:row.id,name:row.name,start:api.baseline(row),fullBefore:row.effective}}]};
    await api.saveReadableDistribution(actor,game.user,'gm',loaded.draft,loaded.fingerprint);
    const tx=await api.applyProgression(actor);globalThis.trainingStyleResult={full:actor.items.filter(item=>item.id==='fyrd'||item.id.startsWith('member')).map(item=>item.system.chance),ticks:actor.items.filter(item=>item.id==='fyrd'||item.id.startsWith('member')).map(item=>item.system.hasExperience),changes:tx.plan.changes.length};
  });const result=await page.evaluate(()=>trainingStyleResult);assert.equal(result.changes,5);assert.ok(result.full.every(value=>value===result.full[0]));assert.deepEqual(result.ticks,Array(5).fill(false));
},true));
async function setupTraining(page,{invest=true}={}) {
  await setupDowntime(page);
  await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    loaded.draft.downtime.requests[0]={...loaded.draft.downtime.requests[0],title:'Study Spirit Dance',type:'training',dp:3};
    await api.saveReadableDistribution(actor,game.user,'gm',loaded.draft,loaded.fingerprint);
    const saved=api.readReadableDistribution(actor.system.background.biography,snap);
    await api.publishDowntimeActivity(actor,'project1',{required:8,showRequired:false,response:'Practice approved.',secret:'SECRET TRAINING',status:'open'},saved.fingerprint);
  });
  if(invest)await page.evaluate(async()=>{await api.applyProgression(actor);});
}

test('Training DP conversion credits existing TP and seasons, publishes the cumulative amount and keeps secrets private',async()=>fixture(async page=>{
  await setupTraining(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    const grant=read();grant.draft.amounts.tp=2;grant.draft.seasons=[{id:'training-season',season:'Earth',choice:'tp',stat:null,start:null}];
    await api.saveReadableDistribution(actor,game.user,'gm',grant.draft,grant.fingerprint);
    const nativeBefore=JSON.stringify(actor.items),plan=api.trainingConversionPlan(actor,'project1',2);
    await api.convertTrainingDP(actor,'project1',2,plan);
    const partial=read(),privatePartial=api.privateDowntime(actor).activities[0];
    await api.convertTrainingDP(actor,'project1',1);
    const final=read(),activity=api.privateDowntime(actor).activities[0],data=api.dmDossiers.get(actor.uuid).data;
    await api.exportGMCharacter(actor,game.user);
    return {partialBase:partial.draft.amounts.tp,partialAvailable:api.availableAmounts(partial.draft).tp,partialConverted:privatePartial.history.filter(e=>e.kind==='trainingConversion').length,finalBase:final.draft.amounts.tp,finalAvailable:api.availableAmounts(final.draft).tp,public:final.draft.downtime.activities[0],invested:activity.invested,converted:api.convertedTrainingDP(activity),events:activity.history.filter(e=>e.kind==='trainingConversion').map(e=>e.dp),nativeUnchanged:JSON.stringify(actor.items)===nativeBefore,secretNotes:actor.system.background.biography.includes('SECRET TRAINING'),exportSecret:JSON.stringify(exported).includes('SECRET TRAINING'),referenceConverted:api.convertedTrainingDP(data.characterBackups.at(-1).privateData.downtime.activities[0]),journal:api.dmDossiers.get(actor.uuid).document.pages.find(p=>p.name==='Downtime — Active').text.content,markdown:api.managerProgressionMarkdown(final.draft,api.readPlayerActor(actor,game.user,'gm'),api.transactionStore(actor),false,api.privateDowntime(actor))};
  });
  assert.equal(result.partialBase,4);assert.equal(result.partialAvailable,6);assert.equal(result.partialConverted,1);assert.equal(result.finalBase,5);assert.equal(result.finalAvailable,7);assert.equal(result.public.convertedDP,3);assert.equal(result.public.required,null);assert.equal(result.invested,3);assert.equal(result.converted,3);assert.deepEqual(result.events,[2,1]);assert.equal(result.nativeUnchanged,true);assert.equal(result.secretNotes,false);assert.equal(result.exportSecret,true);assert.equal(result.referenceConverted,3);assert.match(result.journal,/DP converted to TP: 3/);assert.match(result.markdown,/Training: 2 DPs → 2 TPs: Study Spirit Dance \[In progress\]/);
},true));

test('Training conversion blocks uninvested DP, invalid amounts, non-GM, closed failures and stale confirmations',async()=>fixture(async page=>{
  await setupTraining(page,{invest:false});
  const result=await page.evaluate(async()=>{
    const failures=[];const reject=async action=>{try{await action();failures.push(false);}catch{failures.push(true);}};
    await reject(()=>api.convertTrainingDP(actor,'project1',1));await api.applyProgression(actor);
    const before=JSON.stringify({notes:actor.system.background.biography,private:api.dmDossiers.get(actor.uuid).data});
    for(const amount of [0,-1,1.5,4,NaN])await reject(()=>api.convertTrainingDP(actor,'project1',amount));
    await reject(()=>api.convertTrainingDP(actor,'unknown',1));
    game.user={id:'pc',isGM:false};await reject(()=>api.convertTrainingDP(actor,'project1',1));game.user={id:'gm',isGM:true};
    const unchanged=JSON.stringify({notes:actor.system.background.biography,private:api.dmDossiers.get(actor.uuid).data})===before;
    const plan=api.trainingConversionPlan(actor,'project1',1),loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'project1',{response:'Reviewed response'},loaded.fingerprint);
    await reject(()=>api.convertTrainingDP(actor,'project1',1,plan));
    for(const status of ['failed','cancelled']){const current=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));await api.publishDowntimeActivity(actor,'project1',{status},current.fingerprint);await reject(()=>api.convertTrainingDP(actor,'project1',1));}
    const current=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));await api.publishDowntimeActivity(actor,'project1',{status:'complete'},current.fingerprint);await api.convertTrainingDP(actor,'project1',3);await reject(()=>api.convertTrainingDP(actor,'project1',1));
    return {failures,unchanged,converted:api.convertedTrainingDP(api.privateDowntime(actor).activities[0])};
  });assert.deepEqual(result.failures,Array(12).fill(true));assert.equal(result.unchanged,true);assert.equal(result.converted,3);
},true));

test('Training conversion recovery credits TP and records DP exactly once after publication, private save or unlock failure',async()=>{
  for(const failure of ['publication','private','unlock'])await fixture(async page=>{
    await setupTraining(page);
    const result=await page.evaluate(async failure=>{
      let failed=false;const update=actor.update.bind(actor),doc=api.dmDossiers.get(actor.uuid).document,save=doc.update.bind(doc);
      actor.update=async patch=>{if(!failed&&(failure==='publication'&&patch['system.background.biography']||failure==='unlock'&&patch['flags.world.companionManager.active']===false)){failed=true;throw new Error('Interrupted Training update');}return update(patch);};
      doc.update=async patch=>{const data=patch['flags.world.companionManagerDM'];if(!failed&&failure==='private'&&data?.downtime.activities[0]?.history.some(e=>e.kind==='trainingConversion')&&!data.downtimePending){failed=true;throw new Error('Interrupted private Training commit');}return save(patch);};
      let interrupted=false,blocked=false;try{await api.convertTrainingDP(actor,'project1',3);}catch{interrupted=true;}
      try{await api.convertTrainingDP(actor,'project1',3);}catch{blocked=true;}
      await api.resumeDowntimePublication(actor);
      const loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),activity=api.privateDowntime(actor).activities[0];
      let doubleBlocked=false;try{await api.convertTrainingDP(actor,'project1',3);}catch{doubleBlocked=true;}
      return {interrupted,blocked,doubleBlocked,tp:loaded.draft.amounts.tp,converted:loaded.draft.downtime.activities[0].convertedDP,events:activity.history.filter(e=>e.kind==='trainingConversion').length,pending:!!api.dmDossiers.get(actor.uuid).data.downtimePending,lock:actor.flags.world.companionManager.active};
    },failure);
    assert.deepEqual(result,{interrupted:true,blocked:true,doubleBlocked:true,tp:3,converted:3,events:1,pending:false,lock:false});
  },true);
});

test('Training DM confirmation supports cancellation and a PC spends credited TP without private access or another conversion',async()=>fixture(async page=>{
  await setupTraining(page);
  await page.evaluate(async()=>{foundry.applications.api.DialogV2={confirm:async()=>false};globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='downtime';await app.render();});
  await page.locator('[data-convert-training]').click();await page.locator('[data-training-conversion-form] input[name=dp]').fill('2');
  await page.locator('[data-training-conversion-form] button[type=submit]').click();
  assert.equal(await page.evaluate(()=>api.privateDowntime(actor).activities[0].history.filter(e=>e.kind==='trainingConversion').length),0);
  await page.evaluate(()=>{foundry.applications.api.DialogV2.confirm=async()=>true;});
  await page.locator('[data-training-conversion-form] button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-training-progress]')?.textContent.includes('2 DP → 2 TP'));
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;} ${css}`});await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:1050px;width:1100px;padding:16px;box-sizing:border-box';});await page.screenshot({path:'analysis/Compagnon_Manager_DM_v0150_training.png',fullPage:true});
  await page.evaluate(async()=>{app.element.remove();game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});app.screen='downtime';await app.render();globalThis.trainingPrivateWrites=dossierWrites;globalThis.trainingPackReads=packReads;});
  assert.equal(await page.locator('[data-convert-training]').count(),0);assert.match(await page.locator('[data-training-progress]').innerText(),/2 DP → 2 TP/);
  await page.locator('[data-screen-tab=progression]').click();assert.equal(await page.locator('[data-budget=tp]').inputValue(),'2');
  for(const id of ['scan','dance']){await page.locator(`[data-add=${id}]`).click();await page.locator(`[data-entry=${id}] [data-allocate=tp]`).check();}
  await page.locator('[data-save]').click();await page.waitForFunction(()=>!app.states.get('a').dirty);
  assert.equal(await page.evaluate(()=>dossierWrites===trainingPrivateWrites&&packReads===trainingPackReads),true);
  const result=await page.evaluate(async()=>{game.user={id:'gm',isGM:true};const tx=await api.applyProgression(actor),loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));return {used:tx.plan.balances.used.tp,budget:loaded.draft.amounts.tp,converted:loaded.draft.downtime.activities[0].convertedDP,events:api.privateDowntime(actor).activities[0].history.filter(e=>e.kind==='trainingConversion').length};});
  assert.deepEqual(result,{used:2,budget:0,converted:2,events:1});
},true));

test('Training new investments only unlock newly invested DP and PC cannot forge converted totals',async()=>fixture(async page=>{
  await setupTraining(page);
  const result=await page.evaluate(async()=>{
    await api.convertTrainingDP(actor,'project1',3);
    let loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    const forged=structuredClone(loaded.draft);forged.downtime.activities[0].convertedDP=0;game.user={id:'pc',isGM:false};let forgeBlocked=false;
    try{await api.saveReadableDistribution(actor,game.user,'player',forged,loaded.fingerprint);}catch{forgeBlocked=true;}game.user={id:'gm',isGM:true};
    const next=structuredClone(loaded.draft);next.amounts.dp=2;next.downtime.requests=[{id:'project1',title:'Study Spirit Dance',type:'training',description:'Continue practice.',dp:2,revision:next.downtime.activities[0].revision}];
    await api.saveReadableDistribution(actor,game.user,'gm',next,loaded.fingerprint);await api.applyProgression(actor);
    const plan=api.trainingConversionPlan(actor,'project1',2);await api.convertTrainingDP(actor,'project1',2);
    loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    const activity=api.privateDowntime(actor).activities[0],bad=structuredClone(activity);bad.history.push({...bad.history.find(e=>e.kind==='trainingConversion')});let invalidLedger=false;try{api.convertedTrainingDP(bad);}catch{invalidLedger=true;}
    return {forgeBlocked,available:plan.available,invested:activity.invested,converted:api.convertedTrainingDP(activity),tp:loaded.draft.amounts.tp,invalidLedger};
  });assert.deepEqual(result,{forgeBlocked:true,available:2,invested:5,converted:5,tp:2,invalidLedger:true});
},true));
test('tick filter and Full sorting work across skill rune passion in both managers without changing requests',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  await page.evaluate(async()=>{
    actor.items.push({id:'loyalty',name:'Loyalty',type:'passion',system:{chance:45,hasExperience:true}},{id:'honour',name:'Honour',type:'passion',system:{chance:80,hasExperience:false}},{id:'fire',name:'Fire',type:'rune',system:{chance:60,runeType:{type:'element'},hasExperience:true}});
    await api.initializeDMPack();await api.migrateDMDossier(actor);
  });
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;} ${css}`});
  for(const role of ['gm','pc']) {
    await page.evaluate(async role=>{document.body.replaceChildren();game.user={id:role,isGM:role==='gm'};globalThis.app=role==='gm'?new api.GMProgressionApplication({actorId:'a'}):new api.PlayerProgressionApplication({actorId:'a'});app.screen='progression';await app.render();app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:1000px;width:1100px;padding:16px;box-sizing:border-box';},role);
    await page.locator('[data-sort]').selectOption('full-asc');
    const names=()=>page.locator('[data-browser] tr td:first-child').allTextContents();
    assert.deepEqual(await names(),['Dance','Scan','Spirit Combat']);
    await page.locator('[data-sort]').selectOption('full-desc');assert.deepEqual(await names(),['Spirit Combat','Scan','Dance']);
    await page.locator('[data-ticks-only]').check();assert.deepEqual(await names(),['Spirit Combat','Scan']);
    await page.locator('[data-category]').selectOption('perception');assert.deepEqual(await names(),['Scan']);
    await page.locator('[data-add=scan]').click();
    await page.locator('[data-type]').selectOption('rune');assert.deepEqual(await names(),['Fire']);
    await page.locator('[data-ticks-only]').uncheck();assert.deepEqual(await names(),['Air','Fire']);
    await page.locator('[data-sort]').selectOption('full-asc');assert.deepEqual(await names(),['Fire','Air']);
    await page.locator('[data-type]').selectOption('passion');assert.deepEqual(await names(),['Loyalty','Honour']);
    await page.locator('[data-ticks-only]').check();assert.deepEqual(await names(),['Loyalty']);
    assert.equal(await page.locator('[data-entry=scan]').count(),1);
    const before=await page.evaluate(()=>JSON.stringify({notes:actor.system.background.biography,entries:app.states.get('a').draft.entries}));
    await page.evaluate(async()=>{await app.refresh();});
    assert.equal(await page.locator('[data-ticks-only]').isChecked(),true);assert.equal(await page.locator('[data-sort]').inputValue(),'full-asc');
    assert.equal(await page.evaluate(()=>JSON.stringify({notes:actor.system.background.biography,entries:app.states.get('a').draft.entries})),before);
    if(role==='pc')await page.screenshot({path:'analysis/Compagnon_Manager_PC_v0140_filters.png',fullPage:true});
  }
},true));

test('Obsidian summary aggregates collected ticks and spent ticks before labelled DP lines',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  await page.evaluate(async()=>{
    actor.flags.world??={};actor.flags.world.companionManager={schema:1,active:null,history:[],statTicks:{power:1},characteristicHistory:[]};
    await api.applyCharacteristics(actor,{mode:'collect',rule:'table21'});
    await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});
    await api.initializeDMPack();await api.migrateDMDossier(actor);
    globalThis.app=new api.GMProgressionApplication({actorId:'a'});await app.render();
  });
  assert.match(await page.locator('[data-markdown]').inputValue(),/^- Tick POW \(1 tick\) \+ 1 = POW \(2 ticks\) = \+1 POW \(0 ticks\)\.$/);
  const lines=await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user,'gm'),draft={entries:[],seasons:[],downtime:{activities:['open','complete','failed','cancelled'].map((status,i)=>({id:String(i),status})),requests:['open','complete','failed','cancelled'].map((status,i)=>({id:String(i),title:`Task ${i}`,dp:1}))}};
    return api.managerProgressionMarkdown(draft,snap,api.transactionStore(actor));
  });
  assert.match(lines,/POW \(0 ticks\)\.\n- 1 DPs: Task 0 \[In progress\]\.\n- 1 DPs: Task 1 \[Completed\]\.\n- 1 DPs: Task 2 \[Failed\]\.\n- 1 DPs: Task 3 \[Cancelled\]\./);
  await page.locator('[data-screen-tab=characteristics]').click();
  assert.equal(await page.locator('[data-screen=characteristics] [data-initial-dex]').count(),1);
  assert.equal(await page.locator('[data-screen=training] [data-initial-dex]').count(),0);
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;} ${css}`});await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:1100px;width:1100px;padding:16px;box-sizing:border-box';});await page.screenshot({path:'analysis/Compagnon_Manager_DM_v0140_characteristics.png',fullPage:true});
},true));

test('characteristic reports use seasonal totals and isolate successive distribution windows',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  const result=await page.evaluate(()=>{
    const snapshot=api.readPlayerActor(actor,game.user,'gm');snapshot.characteristics.power.ticks=1;
    const draft={entries:[],seasons:[{choice:'stat',stat:'power',season:'Earth'}]};
    const one=api.progressionMarkdown(draft,snapshot);
    const first={completedAt:'2026-10-01T12:00:00.000Z',plan:{draft:{entries:[],seasons:[]}}};
    const last={completedAt:'2026-10-02T12:00:00.000Z',plan:{draft,statChanges:[{key:'power',before:{value:11,ticks:1},after:{ticks:2},spent:0}]}};
    const store={history:[first,last],characteristicHistory:[{at:'2026-09-30T12:00:00.000Z',mode:'collect',changes:[{key:'charisma',before:{value:18,ticks:0},after:{value:18,ticks:1},spent:0}]},{at:'2026-10-03T12:00:00.000Z',mode:'increase',changes:[{key:'power',before:{value:11,ticks:2},after:{value:12,ticks:0},spent:2}]}]};
    const applied=api.managerProgressionMarkdown({},snapshot,store,true),pending=api.managerProgressionMarkdown({entries:[],seasons:[]},snapshot,store);
    const unavailable=api.filterRows([{type:'skill',category:'a',categoryLabel:'A',name:'Unknown',effective:null},{type:'skill',category:'a',categoryLabel:'A',name:'High',effective:90},{type:'skill',category:'a',categoryLabel:'A',name:'Low',effective:10}],{sort:'full-desc'}).map(row=>row.name);
    return {one,applied,pending,unavailable};
  });
  assert.match(result.one,/- Tick POW \(1 tick\) \+ 1 = POW \(2 ticks\)\./);
  assert.match(result.applied,/- Tick POW \(1 tick\) \+ 1 = POW \(2 ticks\) = \+1 POW \(0 ticks\)\./);assert.doesNotMatch(result.applied,/CHA/);
  assert.equal(result.pending,'- POW (2 ticks) = +1 POW (0 ticks).');assert.deepEqual(result.unavailable,['High','Low','Unknown']);
},true));
const require = createRequire(process.env.RQ_TEST_NODE_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const source = name => readFileSync(new URL(`../koronil-progression/scripts/${name}`, import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const combined = source('core.mjs') + '\nconst esc = escapeHTML;\n' + source('application.mjs') + '\n' + source('distribution.mjs') + '\n' + source('distribution-application.mjs') + '\n' + source('season-training.mjs') + '\n' + source('manager-state.mjs') + '\n' + source('downtime-rules.mjs') + '\n' + source('downtime-application.mjs') + '\n' + source('player-rules.mjs') + '\n' + source('readable-notes.mjs') + '\n' + source('player-application.mjs') + '\n' + source('gm-application.mjs') + '\n' + source('apply-progression.mjs') + '\n' + source('characteristics.mjs') + '\n' + source('dm-compendium.mjs') + '\n' + source('downtime-dm.mjs') + '\n' + source('dm-synchronization.mjs') + '\n' + source('actor-reference.mjs') + '\n' + source('reference-application.mjs');
let browser;
before(async () => { browser = await chromium.launch({headless:true,...(process.env.RQ_TEST_BROWSER_CHANNEL?{channel:process.env.RQ_TEST_BROWSER_CHANNEL}:{})}); });
after(async () => { await browser?.close(); });
async function setupSeasonActor(page) {
  await page.evaluate(()=>{
    actor.system.background.species='Human';
    actor.system.characteristics=Object.fromEntries([['strength',11],['constitution',13],['size',10],['dexterity',15],['intelligence',13],['power',11],['charisma',18]].map(([key,value])=>[key,{value,formula:'3d6',hasExperience:key==='power'?true:null}]));
    actor.getBestEmbeddedDocumentByRqid=()=>null;
  });
}
async function setupCharacteristicActor(page) {
  await setupSeasonActor(page);
  await page.evaluate(()=>{draft={amounts:{xp:0,tp:0,dp:0},entries:[],seasons:[],training:{initialDex:15,speciesMaximum:21}};});
  await prepareApplyFixture(page);
}
async function setupDMPack(page) {
  await page.evaluate(()=>{
    let next=0;foundry.utils.randomID=()=>`private-${++next}`;
    globalThis.packReads=0;globalThis.dossierWrites=0;globalThis.failDossierSave=false;
    const clone=value=>JSON.parse(JSON.stringify(value));
    const set=(target,path,value)=>{const parts=path.split('.');for(const key of parts.slice(0,-1)){target[key]??={};target=target[key];}const key=parts.at(-1);if(key.startsWith('-='))delete target[key.slice(2)];else target[key]=clone(value);};
    const documents=new Map();game.packs=new Map();
    globalThis.privatePack={collection:api.dmPackId,documentName:'JournalEntry',ownership:{PLAYER:'NONE',TRUSTED:'NONE',ASSISTANT:'OWNER',GAMEMASTER:'OWNER'},locked:false,
      configure:async function(config){this.ownership=clone(config.ownership);this.locked=config.locked;},
      getDocument:async id=>{packReads++;return documents.get(id);},getDocuments:async()=>{packReads++;return [...documents.values()];},render:()=>{},
      documentClass:{create:async data=>{
        const doc={...clone(data),id:`doc-${++next}`,pages:data.pages.map((page,index)=>({...clone(page),id:`page-${index}`})),sheet:{render:()=>{}},toObject:function(){const {id,name,flags,ownership,pages}=this;return clone({_id:id,name,flags,ownership,pages});},
          update:async function(patch){dossierWrites++;if(failDossierSave)throw new Error('Simulated dossier save failure');for(const [path,value]of Object.entries(patch))set(this,path,value);return this;},
          createEmbeddedDocuments:async function(type,pages){for(const page of pages)this.pages.push({...clone(page),id:`page-${++next}`});return this.pages;},
          updateEmbeddedDocuments:async function(type,updates){for(const patch of updates){const page=this.pages.find(page=>page.id===patch._id);for(const [path,value]of Object.entries(patch))if(path!=='_id')set(page,path,value);}return this.pages;}};
        documents.set(doc.id,doc);return doc;
      }}
    };
    foundry.documents={collections:{CompendiumCollection:{createCompendium:async()=>{game.packs.set(api.dmPackId,privatePack);return privatePack;}}}};
    const actorUpdate=async patch=>{writes.push(clone(patch));for(const [path,value]of Object.entries(patch))set(actor,path,value);return actor;};
    actor.update=async patch=>{const deletions=Object.fromEntries(Object.entries(patch).filter(([path])=>path.split('.').some(key=>key.startsWith('-=')))),regular=Object.fromEntries(Object.entries(patch).filter(([path])=>!Object.hasOwn(deletions,path)));const result=await actorUpdate(regular);for(const [path,value]of Object.entries(deletions))set(actor,path,value);return result;};
  });
}
test('DM compendium initializes once, migrates verified private data, and preserves unrelated character notes',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[{id:'old',plan:{markdownSummary:'PRIVATE history'}}],statTicks:{power:4},characteristicHistory:[]}};
    actor.system.background.biography+='\n<h3>Compagnon Manager — Export history</h3><p><strong>Before application</strong><br>Export requested (UTC): 2026-10-07T10:00:00Z<br>File: fvtt-Actor-Koronil-a-20261007T100000000Z.json<br>DM: Owner</p>';
    await api.initializeDMPack();const first=await api.migrateDMDossier(actor);await api.migrateDMDossier(actor);
    const source=actor.toObject(),cache=api.dmDossiers.get(actor.uuid).data;
    return {count:(await privatePack.getDocuments()).length,permissions:privatePack.ownership,pages:first.pages.map(page=>page.name),public:source.flags.world.companionManager,privateTicks:cache.progression.statTicks.power,privateHistory:cache.progression.history.length,archive:cache.migration.exportNotes.length,notes:source.system.background.biography,secret:JSON.stringify(source).includes('PRIVATE history')};
  });
  assert.equal(result.count,1);assert.equal(result.permissions.PLAYER,'NONE');assert.equal(result.permissions.TRUSTED,'NONE');assert.deepEqual(result.pages,['Identity','Character backups','Characteristic ticks','Progression history','Export history','Downtime — DM','Downtime — Active','Downtime — Completed','Downtime — Failed','Private notes','Migration archive']);assert.deepEqual(Object.keys(result.public).sort(),['active','dossier','schema']);assert.equal(result.privateTicks,4);assert.equal(result.privateHistory,1);assert.equal(result.archive,1);assert.match(result.notes,/Anciennes notes/);assert.doesNotMatch(result.notes,/Export requested/);assert.equal(result.secret,false);
},true));
test('Summary is DM landing screen, tabs follow requested order and initialization is available there',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});
  await page.evaluate(async()=>{globalThis.app=new api.GMProgressionApplication({actorId:'a'});await app.render();});
  await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});
  assert.deepEqual(await page.locator('[data-screen-tab]').evaluateAll(tabs=>tabs.map(tab=>tab.textContent)),['Summary','Characteristics','XP / TP','Season training','Downtime']);assert.equal(await page.locator('[data-screen=summary]').isVisible(),true);assert.equal(await page.locator('[data-save]').isDisabled(),true);
  await page.locator('[data-initialize-dossier]').click();await page.waitForFunction(()=>actor.flags.world?.companionManager?.schema===2&&document.querySelector('[data-open-dossier]').disabled===false);
  assert.equal(await page.locator('[data-screen=summary]').isVisible(),true);assert.equal(await page.locator('[data-save]').isDisabled(),false);
  await page.screenshot({path:new URL('../../analysis/Compagnon_Manager_DM_summary_v0100.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
},true));
test('migration failure preserves source data and reuses its verified private copy on retry',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{power:3}}};await api.initializeDMPack();
    const update=actor.update.bind(actor),notes=actor.system.background.biography;actor.update=async()=>{throw new Error('Interrupted actor cleanup');};
    let failed=false;try{await api.migrateDMDossier(actor);}catch{failed=true;}
    const preserved=actor.flags.world.companionManager.statTicks.power===3&&actor.system.background.biography===notes;
    actor.update=update;await api.migrateDMDossier(actor);
    return {failed,preserved,count:(await privatePack.getDocuments()).length,ticks:api.transactionStore(actor).statTicks.power,clean:actor.flags.world.companionManager.statTicks===undefined};
  });assert.deepEqual(result,{failed:true,preserved:true,count:1,ticks:3,clean:true});
},true));
test('partial migration cleanup can resume when the public link exists but private fields remain',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{power:5}}};await api.initializeDMPack();const update=actor.update.bind(actor);
    actor.update=async patch=>update(Object.fromEntries(Object.entries(patch).filter(([path])=>!path.includes('.-='))));
    let failed=false;try{await api.migrateDMDossier(actor);}catch{failed=true;}
    actor.update=update;await api.migrateDMDossier(actor);
    return {failed,ticks:api.transactionStore(actor).statTicks.power,publicKeys:Object.keys(actor.flags.world.companionManager).sort(),count:(await privatePack.getDocuments()).length};
  });assert.deepEqual(result,{failed:true,ticks:5,publicKeys:['active','dossier','schema'],count:1});
},true));
test('editing private notes survives generated-page refresh and no PC UI can read private counters',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  await page.evaluate(async()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{power:12345}}};await api.initializeDMPack();await api.migrateDMDossier(actor);
    api.dmDossiers.get(actor.uuid).document.pages.find(page=>page.name==='Downtime — DM').text.content='<p>SECRET consequence</p>';
    await api.saveDMDossier(actor,{exports:[]});game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });await page.locator('[data-screen-tab=training]').click();
  assert.doesNotMatch(await page.locator('[data-screen=training]').innerText(),/12345|Accumulated characteristic ticks|SECRET/);
  assert.equal(await page.locator('[data-screen-tab=summary]').count(),0);
  const secret=await page.evaluate(()=>{game.user={id:'gm',isGM:true};return api.dmDossiers.get(actor.uuid).document.pages.find(page=>page.name==='Downtime — DM').text.content;});assert.match(secret,/SECRET consequence/);
},true));
test('private counters never appear in PC snapshot or notes; seasonal ticks and wishes still complete a DM cycle',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{power:7}}};await api.initializeDMPack();await api.migrateDMDossier(actor);
    const dm=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,dm);
    const award={amounts:{xp:1,tp:0,dp:0},entries:[],training:{initialDex:15,speciesMaximum:21},seasons:[{id:'private-season',season:'Earth',choice:'pending',stat:null,start:null}]};
    await api.saveReadableDistribution(actor,game.user,'gm',award,loaded.fingerprint);
    game.user={id:'pc',isGM:false};const beforeReads=packReads,pc=api.readPlayerActor(actor,game.user,'player'),saved=api.readReadableDistribution(actor.system.background.biography,pc);
    const stat=pc.characteristics.power;saved.draft.seasons[0]={...saved.draft.seasons[0],choice:'stat',stat:'power',start:{value:stat.value,ticks:stat.ticks,checked:stat.checked}};
    saved.draft.entries=[{itemId:'scan',name:'Scan',type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(pc.rows.find(row=>row.id==='scan'))}];
    await api.saveReadableDistribution(actor,game.user,'player',saved.draft,saved.fingerprint);
    const publicTicks=pc.characteristics.power.ticks,extraReads=packReads-beforeReads;
    game.user={id:'gm',isGM:true};await api.loadDMDossier(actor);await api.applyProgression(actor);
    return {publicTicks,extraReads,privateTicks:api.transactionStore(actor).statTicks.power,nativeChecked:actor.system.characteristics.power.hasExperience,scan:actor.items[0].system.gainedChance,history:api.transactionStore(actor).history.length,public:actor.flags.world.companionManager,remaining:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.amounts};
  });
  assert.equal(result.publicTicks,0);assert.equal(result.extraReads,0);assert.equal(result.privateTicks,8);assert.equal(result.nativeChecked,true);assert.equal(result.scan,50);assert.equal(result.history,1);assert.deepEqual(result.remaining,{xp:0,tp:0,dp:0});assert.deepEqual(Object.keys(result.public).sort(),['active','dossier','schema']);assert.equal(result.public.active,false);
},true));
test('DM backup includes actor, all private dossier pages and five FIFO export references without adding secrets to actor',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);const cached=api.dmDossiers.get(actor.uuid);
    cached.document.pages.find(page=>page.name==='Private notes').text.content='<p>SECRET contact</p>';
    await api.saveDMDossier(actor,{progression:{...cached.data.progression,statTicks:{power:9}}});
    const notes=actor.system.background.biography;for(let index=0;index<7;index++)await api.exportGMCharacter(actor);
    return {format:exported.format,ticks:exported.dossier.flags.world.companionManagerDM.progression.statTicks.power,secret:exported.dossier.pages.find(page=>page.name==='Private notes').text.content,exports:exported.dossier.flags.world.companionManagerDM.exports.length,last:exported.dossier.flags.world.companionManagerDM.exports.at(-1).filename,filename:exportFilename,actorSecret:JSON.stringify(exported.actor).includes('SECRET contact'),notesUnchanged:actor.system.background.biography===notes};
  });assert.equal(result.format,'CompagnonManagerDMBackup');assert.equal(result.ticks,9);assert.match(result.secret,/SECRET contact/);assert.equal(result.exports,5);assert.equal(result.last,result.filename);assert.match(result.filename,/Compagnon-DM-.*\d{8}T\d{9}Z\.json$/);assert.equal(result.actorSecret,false);assert.equal(result.notesUnchanged,true);
},true));
test('private compendium blocks player access, exposed permissions, duplicate migration and mismatched dossier links',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);let blocked=0;
    game.user={id:'pc',isGM:false};try{await api.loadDMDossier(actor);}catch{blocked++;}try{await api.initializeDMPack();}catch{blocked++;}
    game.user={id:'gm',isGM:true};privatePack.ownership.TRUSTED='OBSERVER';try{await api.loadDMDossier(actor);}catch{blocked++;}
    await api.initializeDMPack();actor.flags.world.companionManager.dossier.id='wrong';try{await api.loadDMDossier(actor);}catch{blocked++;}
    return blocked;
  });assert.equal(result,4);
},true));
test('private progression cleanup failure resumes without duplicated XP or season ticks',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const draft={...loaded.draft,amounts:{xp:1,tp:0,dp:0},entries:[{itemId:'scan',name:'Scan',type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(snap.rows.find(row=>row.id==='scan'))}]};
    await api.saveReadableDistribution(actor,game.user,'gm',draft,loaded.fingerprint);
    const update=actor.update.bind(actor);let fail=true;actor.update=async patch=>{if(fail&&patch['system.background.biography']){fail=false;throw new Error('Interrupted cleanup');}return update(patch);};
    let failed=false;try{await api.applyProgression(actor);}catch{failed=true;}const gained=actor.items[0].system.gainedChance;
    await api.applyProgression(actor);return {failed,gained,final:actor.items[0].system.gainedChance,history:api.transactionStore(actor).history.length,active:actor.flags.world.companionManager.active};
  });assert.deepEqual(result,{failed:true,gained:50,final:50,history:1,active:false});
},true));
test('private characteristic collection recovers native toggle clearing without duplicating the pending tick',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);await setupDMPack(page);
  const result=await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);
    const update=actor.update.bind(actor);actor.update=async patch=>{const result=await update(patch);if(patch['system.characteristics.power.hasExperience']===false)failDossierSave=true;return result;};
    let failed=false;try{await api.applyCharacteristics(actor,{mode:'collect',rule:'table21'});}catch{failed=true;}
    failDossierSave=false;actor.update=update;await api.loadDMDossier(actor);await api.resumeCharacteristics(actor);
    return {failed,ticks:api.transactionStore(actor).statTicks.power,checked:actor.system.characteristics.power.hasExperience,pending:api.dmDossiers.get(actor.uuid).data.characteristicPending,public:actor.flags.world.companionManager.active};
  });assert.deepEqual(result,{failed:true,ticks:1,checked:false,pending:null,public:false});
},true));
test('collecting native Experience toggles adds exactly one each and clears them in the same actor update',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    actor.system.characteristics.strength.hasExperience=true;
    actor.system.characteristics.intelligence.hasExperience=true;
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{strength:4,charisma:6}}};
    const notes=actor.system.background.biography,before=writes.length;
    await api.applyCharacteristics(actor,{mode:'collect',rule:'table21'});
    const firstWrites=writes.length-before,patch=writes.at(-1);
    let secondBlocked=false;const after=writes.length;try{await api.applyCharacteristics(actor,{mode:'collect',rule:'table21'});}catch{secondBlocked=true;}
    return {counts:actor.flags.world.companionManager.statTicks,str:actor.system.characteristics.strength,pow:actor.system.characteristics.power,int:actor.system.characteristics.intelligence,charisma:actor.system.characteristics.charisma,firstWrites,patchKeys:Object.keys(patch).sort(),secondBlocked,extraWrites:writes.length-after,notes:notes===actor.system.background.biography,itemWrites:itemWrites.length};
  });
  assert.deepEqual(result.counts,{strength:5,charisma:6,intelligence:1,power:1});assert.equal(result.str.value,11);assert.equal(result.pow.value,11);assert.equal(result.int.value,13);assert.equal(result.charisma.value,18);assert.equal(result.str.hasExperience,false);assert.equal(result.pow.hasExperience,false);assert.equal(result.int.hasExperience,false);assert.equal(result.charisma.hasExperience,null);assert.equal(result.firstWrites,1);assert.deepEqual(result.patchKeys,['flags.world.companionManager','system.characteristics.intelligence.hasExperience','system.characteristics.power.hasExperience','system.characteristics.strength.hasExperience']);assert.equal(result.secondBlocked,true);assert.equal(result.extraWrites,0);assert.equal(result.notes,true);assert.equal(result.itemWrites,0);
},true));
test('collect button checks native toggles, supports cancel, disables after collection and no counter operation re-arms a toggle',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  await page.evaluate(async()=>{
    await api.applyCharacteristics(actor,{mode:'force',forced:{power:5},rule:'table21'});
    globalThis.confirmResult=false;foundry.applications.api.DialogV2={confirm:async()=>confirmResult};
    await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
  });
  await page.locator('[data-screen-tab=characteristics]').click();assert.equal(await page.locator('[data-collect-characteristic-ticks]').isDisabled(),false);
  const before=await page.evaluate(()=>writes.length);await page.locator('[data-collect-characteristic-ticks]').click();assert.equal(await page.evaluate(()=>writes.length),before);
  await page.evaluate(()=>{confirmResult=true;});await page.locator('[data-collect-characteristic-ticks]').click();
  await page.waitForFunction(()=>api.transactionStore(actor).statTicks.power===6&&document.querySelector('[data-collect-characteristic-ticks]').disabled);
  assert.equal(await page.locator('[data-characteristic=power] [data-characteristic-experience]').innerText(),'—');
  const result=await page.evaluate(async()=>{
    await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});
    await api.applyCharacteristics(actor,{mode:'force',forced:{power:8,dexterity:4},rule:'table21'});
    return {checked:actor.system.characteristics.power.hasExperience,dexChecked:actor.system.characteristics.dexterity.hasExperience,powTicks:api.transactionStore(actor).statTicks.power};
  });assert.deepEqual(result,{checked:false,dexChecked:null,powTicks:8});
},true));
test('collect preserves a pending toggle on failure and blocks stale confirmation or non-GM before writing',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    const options={mode:'collect',rule:'table21'},plan=api.characteristicPlan(actor,options),update=actor.update.bind(actor),before=writes.length;
    let failed=false;actor.update=async()=>{throw new Error('Simulated update failure');};try{await api.applyCharacteristics(actor,options);}catch{failed=true;}
    const pending=actor.system.characteristics.power.hasExperience,count=api.readPlayerActor(actor,game.user).characteristics.power.ticks;
    actor.update=update;actor.system.characteristics.power.hasExperience=false;
    let stale=false;try{await api.applyCharacteristics(actor,options,game.user,plan);}catch{stale=true;}
    actor.system.characteristics.power.hasExperience=true;let pc=false;try{await api.applyCharacteristics(actor,options,{isGM:false});}catch{pc=true;}
    const rejectedWrites=writes.length-before;
    await api.applyCharacteristics(actor,options);
    return {failed,pending,count,stale,pc,rejectedWrites,after:actor.flags.world.companionManager.statTicks.power,cleared:actor.system.characteristics.power.hasExperience};
  });assert.deepEqual(result,{failed:true,pending:true,count:0,stale:true,pc:true,rejectedWrites:0,after:1,cleared:false});
},true));
test('characteristic table follows every supplied boundary and blocks unsupported maxima',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>({costs:[3,9,10,15,16,17,18,19,20,21].map(value=>api.characteristicCost(value,21,'table21')),unsupported:api.characteristicCost(18,25,'table21')}));
  assert.deepEqual(result,{costs:[1,1,2,2,3,3,4,4,5,null],unsupported:null});
},true));
test('forced characteristic counters preserve values and notes and are visible in PC season training only',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    const before=actor.system.background.biography;
    await api.applyCharacteristics(actor,{mode:'force',forced:{strength:7,power:0,intelligence:3},rule:'table21'});
    return {strength:actor.system.characteristics.strength,power:actor.system.characteristics.power.value,powerTick:actor.system.characteristics.power.hasExperience,counts:actor.flags.world.companionManager.statTicks,notes:actor.system.background.biography===before,itemWrites:itemWrites.length};
  });
  assert.equal(result.strength.value,11);assert.equal(result.strength.hasExperience,null);assert.equal(result.power,11);assert.equal(result.powerTick,true);assert.deepEqual(result.counts,{strength:7,power:0,intelligence:3});assert.equal(result.notes,true);assert.equal(result.itemWrites,0);
  await page.evaluate(async()=>{await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();});
  await page.locator('[data-screen-tab=characteristics]').click();assert.equal(await page.locator('[data-characteristic]').count(),7);
  await page.locator('[data-screen-tab=training]').click();assert.equal(await page.locator('[data-screen=characteristics]').isHidden(),true);assert.doesNotMatch(await page.locator('[data-screen=training]').innerText(),/Accumulated characteristic ticks/);
  await page.evaluate(async()=>{app.element.remove();game.user={id:'pc',isGM:false};app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  assert.equal(await page.locator('[data-screen-tab=characteristics]').count(),0);await page.locator('[data-screen-tab=training]').click();assert.doesNotMatch(await page.locator('[data-screen=training]').innerText(),/Accumulated characteristic ticks/);
},true));
test('characteristic increases spend the table cost, retain surplus and recalculate the next cost',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    actor.system.characteristics.power.value=15;actor.system.characteristics.charisma.value=20;
    await api.applyCharacteristics(actor,{mode:'force',forced:{power:5,charisma:6,strength:1,intelligence:20,size:20},rule:'table21'});
    const before=actor.system.background.biography;
    const first=await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});
    const mid={pow:actor.system.characteristics.power.value,powTicks:actor.flags.world.companionManager.statTicks.power,cha:actor.system.characteristics.charisma.value,chaTicks:actor.flags.world.companionManager.statTicks.charisma};
    await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});
    let blocked=false;try{await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});}catch{blocked=true;}
    return {spent:first.changes.map(change=>[change.label,change.spent]),mid,pow:actor.system.characteristics.power.value,ticks:actor.flags.world.companionManager.statTicks.power,checked:actor.system.characteristics.power.hasExperience,int:actor.system.characteristics.intelligence.value,siz:actor.system.characteristics.size.value,notes:before===actor.system.background.biography,blocked};
  });
  assert.deepEqual(result.spent,[['POW',2],['CHA',5]]);assert.deepEqual(result.mid,{pow:16,powTicks:3,cha:21,chaTicks:1});assert.equal(result.pow,17);assert.equal(result.ticks,0);assert.equal(result.checked,true);assert.equal(result.int,13);assert.equal(result.siz,10);assert.equal(result.notes,true);assert.equal(result.blocked,true);
},true));
test('DEX training cap and missing initial DEX prevent increases while surplus ticks survive',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(()=>{
    actor.flags.world={companionManager:{schema:1,active:null,history:[],statTicks:{dexterity:10}}};
    const snap=api.readPlayerActor(actor,game.user,'gm');
    return [api.characteristicRows(snap,{initialDex:10,speciesMaximum:21},'table21').find(row=>row.key==='dexterity'),api.characteristicRows(snap,{initialDex:null,speciesMaximum:21},'table21').find(row=>row.key==='dexterity')];
  });
  assert.equal(result[0].maximum,15);assert.equal(result[0].eligible,false);assert.equal(result[0].ticks,10);assert.match(result[1].reason,/initial DEX/);
},true));
test('counter updates reject non-GM, invalid counts, active transactions and stale confirmation without writing',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    const options={mode:'force',forced:{strength:4},rule:'table21'},plan=api.characteristicPlan(actor,options),before=writes.length;
    let rejected=0;
    for(const value of [-1,1.5,1000001])try{await api.applyCharacteristics(actor,{...options,forced:{strength:value}});}catch{rejected++;}
    try{await api.applyCharacteristics(actor,options,{id:'pc',isGM:false});}catch{rejected++;}
    actor.flags.world={companionManager:{schema:1,active:{status:'pending'},history:[]}};try{await api.applyCharacteristics(actor,options);}catch{rejected++;}
    actor.flags.world.companionManager.active=null;actor.system.characteristics.strength.value++;
    try{await api.applyCharacteristics(actor,options,game.user,plan);}catch{rejected++;}
    return {rejected,writes:writes.length-before};
  });
  assert.deepEqual(result,{rejected:6,writes:0});
},true));
test('saved seasonal stat wishes block characteristic edits until applied or removed',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    loaded.draft.seasons=[{id:'season-stat',season:'Earth',choice:'stat',stat:'dexterity',start:snap.characteristics.dexterity}];
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,loaded.draft,snap,game.user,loaded.fingerprint,'season-char');
    const before=writes.length;let message='';try{await api.applyCharacteristics(actor,{mode:'force',forced:{power:5},rule:'table21'});}catch(error){message=error.message;}
    return {message,writes:writes.length-before};
  });
  assert.match(result.message,/seasonal stat tick requests/);assert.equal(result.writes,0);
},true));
test('DM characteristic actions confirm before replacing ticks, preserve cancel, and apply through the UI',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});
  await page.evaluate(async()=>{globalThis.confirmResult=false;foundry.applications.api.DialogV2={confirm:async()=>confirmResult};await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();});
  await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});
  await page.locator('[data-screen-tab=characteristics]').click();await page.locator('[data-force-ticks=charisma]').fill('4');
  const before=await page.evaluate(()=>writes.length);await page.locator('[data-save-characteristic-ticks]').click();assert.equal(await page.evaluate(()=>writes.length),before);
  await page.evaluate(()=>{confirmResult=true;});await page.locator('[data-save-characteristic-ticks]').click();
  await page.waitForFunction(()=>api.transactionStore(actor).statTicks?.charisma===4&&document.querySelector('[data-force-ticks=charisma]').value==='');
  assert.equal(await page.locator('[data-apply-characteristics]').isDisabled(),false);
  await page.screenshot({path:new URL('../../analysis/Compagnon_Manager_DM_characteristics_v090.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await page.locator('[data-apply-characteristics]').click();await page.waitForFunction(()=>actor.system.characteristics.charisma.value===19);
  assert.equal(await page.evaluate(()=>api.transactionStore(actor).statTicks.charisma),0);
},true));
test('DEX increase invokes native Dodge/Jump base updates without spending skill XP or TP',async()=>fixture(async page=>{
  await setupCharacteristicActor(page);
  const result=await page.evaluate(async()=>{
    for(const [id,base]of [['dodge',30],['jump',45]])actor.items.push({id,name:id,type:'skill',system:{baseChance:base,gainedChance:7,chance:base+7,categoryMod:0,category:'agility',hasExperience:true,canGetExperience:true},_source:{system:{baseChance:base,gainedChance:7,hasExperience:true}}});
    actor.getBestEmbeddedDocumentByRqid=rqid=>actor.items.find(item=>item.id===(rqid.endsWith('.dodge')?'dodge':rqid.endsWith('.jump')?'jump':''));
    const update=actor.update.bind(actor);
    actor.update=async patch=>{
      const dex=patch['system.characteristics.dexterity.value']??actor.system.characteristics.dexterity.value;
      for(const [id,multiple]of [['dodge',2],['jump',3]]){const item=actor.items.find(item=>item.id===id);item.system.baseChance=dex*multiple;item._source.system.baseChance=dex*multiple;item.system.chance=dex*multiple+item.system.gainedChance;}
      return update(patch);
    };
    await api.applyCharacteristics(actor,{mode:'force',forced:{dexterity:2},rule:'table21'});
    await api.applyCharacteristics(actor,{mode:'increase',rule:'table21'});
    return {dex:actor.system.characteristics.dexterity.value,ticks:actor.flags.world.companionManager.statTicks.dexterity,skills:actor.items.filter(item=>['dodge','jump'].includes(item.id)).map(item=>({base:item.system.baseChance,gained:item.system.gainedChance,tick:item.system.hasExperience})),budgets:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.amounts};
  });
  assert.deepEqual(result,{dex:16,ticks:0,skills:[{base:32,gained:7,tick:true},{base:48,gained:7,tick:true}],budgets:{xp:0,tp:0,dp:0}});
},true));
test('initial DEX updates while focused, persists from DM to PC and allows a DEX tick',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  await page.evaluate(async()=>{let n=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`dex-focus-${++n}`,configurable:true});await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();});
  await page.locator('[data-screen-tab=training]').click();await page.locator('[data-add-season-reward]').click();
  await page.locator('[data-screen-tab=characteristics]').click();
  await page.locator('[data-initial-dex]').fill('15');
  const focused=await page.evaluate(()=>({value:app.states.get(actor.id).draft.training.initialDex,dirty:app.states.get(actor.id).dirty,focused:document.activeElement===document.querySelector('[data-initial-dex]')}));
  assert.deepEqual(focused,{value:15,dirty:true,focused:true});
  await page.locator('[data-save-training-settings]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty);
  await page.evaluate(async()=>{app.element.remove();game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  await page.locator('[data-screen-tab=training]').click();
  assert.equal(await page.locator('[data-initial-dex],[data-species-maximum]').count(),0);
  assert.equal(await page.evaluate(()=>app.states.get(actor.id).draft.training.initialDex),15);
  await page.locator('[data-season-choice]').selectOption('stat');
  assert.equal(await page.locator('[data-season-stat] option[value=dexterity]').isDisabled(),false);
  await page.locator('[data-season-stat]').selectOption('dexterity');
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=2&&!app.states.get(actor.id).dirty);
  await page.evaluate(()=>{game.user={id:'gm',isGM:true};draft=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft;});
  await prepareApplyFixture(page);
  const applied=await page.evaluate(async()=>{await api.applyProgression(actor);return {dex:actor.system.characteristics.dexterity.value,checked:actor.system.characteristics.dexterity.hasExperience,ticks:actor.flags.world.companionManager.statTicks.dexterity};});
  assert.deepEqual(applied,{dex:15,checked:null,ticks:1});
},true));
test('PC assigned TP shows base plus all season bonuses and saves spending above the base budget',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    let n=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`tp-total-${++n}`,configurable:true});
    for(const [id,name]of [['swim','Swim'],['farm','Farm']])actor.items.push({id,name,type:'skill',system:{baseChance:10,gainedChance:20,chance:35,categoryMod:5,category:'agility',hasExperience:false,canGetExperience:true}});
    const snap=api.readPlayerActor(actor,game.user),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const grant={amounts:{xp:0,tp:1,dp:0},entries:[],training:{initialDex:null,speciesMaximum:null},seasons:['Earth','Dark'].map((season,index)=>({id:`award-${index}`,season,choice:'pending',stat:null,start:null}))};
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,grant,snap,game.user,loaded.fingerprint,'dm-grant');
    game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });
  await page.locator('[data-screen-tab=training]').click();
  await page.locator('[data-season-choice]').nth(0).selectOption('tp');
  await page.locator('[data-season-choice]').nth(1).selectOption('tp');
  await page.locator('[data-screen-tab=progression]').click();
  assert.equal(await page.locator('[data-budget=tp]').inputValue(),'5');
  for(const id of ['scan','dance','swim','farm']) {await page.locator(`[data-add=${id}]`).click();await page.locator(`[data-entry=${id}] [data-allocate=tp]`).check();}
  assert.equal(await page.locator('[data-used=tp]').innerText(),'4');assert.equal(await page.locator('[data-remaining=tp]').innerText(),'1');
  assert.equal(await page.locator('[data-save]').isDisabled(),false);
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  const saved=await page.evaluate(()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft);
  assert.equal(saved.amounts.tp,1);assert.equal(saved.entries.reduce((sum,entry)=>sum+entry.tp,0),4);
  assert.equal(await page.locator('[data-budget=tp]').inputValue(),'5');
},true));
test('export history is FIFO with five entries and preserves unrelated notes and distribution sections',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user),before=api.readReadableDistribution(actor.system.background.biography,snap).fingerprint;
    const filenames=[];
    for(let n=0;n<7;n++) {
      actor.name=`Koronil-${n}`;
      filenames.push(await api.exportGMCharacter(actor,game.user,n%2?'After application':'Before application'));
    }
    const doc=new DOMParser().parseFromString(actor.system.background.biography,'text/html');
    return {filenames,live:actor.system.background.biography,snapshot:exported.system.background.biography,count:[...doc.querySelectorAll('p')].filter(p=>p.textContent.includes('Export requested (UTC):')).length,fingerprint:api.readReadableDistribution(actor.system.background.biography,snap).fingerprint,before};
  });
  assert.equal(result.count,5);assert.equal(result.live,result.snapshot);assert.equal(result.fingerprint,result.before);
  assert.ok(result.live.startsWith('<p>Anciennes notes &amp; histoire.</p>'));
  result.filenames.forEach((filename,index)=>assert.equal(result.live.includes(filename),index>=2));
},true));
test('Obsidian Markdown uses starting ticks and rune categories and remains available after apply',async()=>fixture(async page=>{
  await page.evaluate(()=>{
    const row=api.readPlayerActor(actor,game.user).rows.find(row=>row.id==='dance');
    draft.amounts={xp:2,tp:1,dp:0};draft.entries.push({itemId:row.id,type:row.type,name:row.name,xp:1,tp:0,direction:'add',start:api.baseline(row)});
  });
  await prepareApplyFixture(page);
  await page.evaluate(async()=>{await api.applyProgression(actor);await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();});
  await page.locator('[data-screen-tab=summary]').click();
  assert.equal(await page.locator('[data-summary-source]').inputValue(),'applied');
  assert.equal(await page.locator('[data-markdown]').inputValue(),'- 2 XPs: (Tick): Scan. XPs (without Tick): Dance.\n- 1 TPs: Scan.');
  const rune=await page.evaluate(()=>api.progressionMarkdown({entries:[{itemId:'spiritRune',name:'Spirit',type:'rune',xp:1,tp:0,start:{tick:false}}]},{rows:[{id:'spiritRune',category:'form'}]}));
  assert.match(rune,/Form: Spirit/);
},true));
test('DM adds multiple seasons, PC chooses TP or stat, and only notes are saved before DM applies',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  await page.evaluate(async()=>{
    let n=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`season-ui-${++n}`,configurable:true});
    await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
  });
  await page.locator('[data-screen-tab=characteristics]').click();
  await page.locator('[data-initial-dex]').fill('15');await page.locator('[data-initial-dex]').dispatchEvent('change');
  await page.locator('[data-screen-tab=training]').click();
  for(const season of ['Earth','Dark']){await page.locator('[data-add-season]').selectOption(season);await page.locator('[data-add-season-reward]').click();}
  assert.equal(await page.locator('[data-season-reward]').count(),2);
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty);
  const before=await page.evaluate(()=>JSON.stringify({items:actor.items,stats:actor.system.characteristics,flags:actor.flags}));
  await page.evaluate(async()=>{app.element.remove();game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  await page.locator('[data-screen-tab=training]').click();
  assert.equal(await page.locator('[data-add-season-reward]').count(),0);
  await page.locator('[data-season-choice]').nth(0).selectOption('tp');
  await page.locator('[data-season-choice]').nth(1).selectOption('stat');
  await page.locator('[data-season-stat]').selectOption('strength');
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial; background:#eee; color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});
  await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});
  await page.screenshot({path:new URL('../../analysis/Compagnon_Manager_PC_seasons_v080.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await page.locator('[data-screen-tab=progression]').click();
  assert.match(await page.locator('[data-season-bonus]').innerText(),/\+2 TP.*Total available: 2/);
  await page.locator('[data-add=scan]').click();await page.locator('[data-entry=scan] [data-allocate=tp]').check();
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=2&&!app.states.get(actor.id).dirty);
  const result=await page.evaluate(()=>({state:JSON.stringify({items:actor.items,stats:actor.system.characteristics,flags:actor.flags}),draft:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft,errors}));
  assert.equal(result.state,before);assert.equal(result.draft.seasons.length,2);assert.equal(result.draft.seasons[0].choice,'tp');assert.equal(result.draft.seasons[1].stat,'strength');assert.equal(result.draft.entries[0].tp,1);
},true));
test('season TP bonuses stack without changing DM base budget and cannot be forged by the PC',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user),settings={initialDex:null,speciesMaximum:null};
    const awards=['Earth','Earth','Storm'].map((season,index)=>({id:`reward-${index}`,season,choice:'tp',stat:null,start:null}));
    draft.amounts.tp=0;draft.seasons=awards;draft.training=settings;
    const loaded=api.readReadableDistribution(actor.system.background.biography,snap),html=api.writeReadableDistribution(actor.system.background.biography,draft,snap,game.user,loaded.fingerprint,'season-one');
    const saved=api.readReadableDistribution(html,snap),amounts=api.availableAmounts(saved.draft);
    const tampered=JSON.parse(JSON.stringify(saved.draft));tampered.seasons.push({id:'fake',season:'Sea',choice:'tp',stat:null,start:null});
    let rejected=false;try{api.writeReadableDistribution(html,tampered,snap,{id:'pc',isGM:false},saved.fingerprint,'fake-reward');}catch{rejected=true;}
    const corrupted=new DOMParser().parseFromString(html,'text/html');corrupted.querySelectorAll('table')[2].rows[1].cells[4].textContent='123';
    let corruptedRejected=false;try{api.readReadableDistribution(corrupted.body.innerHTML,snap);}catch{corruptedRejected=true;}
    return {base:saved.draft.amounts.tp,total:amounts.tp,rejected,corruptedRejected,remaining:api.validatePlayerDraft(saved.draft,snap).remaining.tp};
  });assert.deepEqual(result,{base:0,total:6,rejected:true,corruptedRejected:true,remaining:5});
},true));
test('two seasonal ticks on one characteristic accumulate and recovery does not add them twice',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user),stat=snap.characteristics.power;
    draft={amounts:{xp:0,tp:0,dp:0},entries:[],training:{initialDex:15,speciesMaximum:21},seasons:['Earth','Dark'].map((season,index)=>({id:`stat-season-${index}`,season,choice:'stat',stat:'power',start:{value:stat.value,ticks:stat.ticks,checked:stat.checked}}))};
  });await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    failCleanup=true;let interrupted=false;try{await api.applyProgression(actor);}catch{interrupted=true;}
    const ticksBeforeResume=api.readPlayerActor(actor,game.user).characteristics.power.ticks;
    failCleanup=false;const tx=await api.applyProgression(actor),loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user));
    return {interrupted,ticksBeforeResume,ticks:actor.flags.world.companionManager.statTicks.power,value:actor.system.characteristics.power.value,checked:actor.system.characteristics.power.hasExperience,seasons:loaded.draft.seasons.length,summary:tx.plan.markdownSummary,itemWrites:itemWrites.length};
  });
  assert.equal(result.interrupted,true);assert.equal(result.ticksBeforeResume,2);assert.equal(result.ticks,2);assert.equal(result.value,11);assert.equal(result.checked,true);assert.equal(result.seasons,0);assert.equal(result.itemWrites,0);assert.match(result.summary,/1 Stat Tick \(POW\)/);
},true));
test('training eligibility excludes INT/SIZ, requires initial DEX and observes characteristic maxima',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  const result=await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user),missing=api.characteristicOptions(snap,{initialDex:null,speciesMaximum:21});
    const dexLimit=api.characteristicOptions(snap,{initialDex:10,speciesMaximum:21});
    snap.characteristics.strength.value=21;
    const maximum=api.characteristicOptions(snap,{initialDex:15,speciesMaximum:21});
    return {keys:missing.map(option=>option.key),missing:missing.find(option=>option.key==='dexterity').reason,dex:dexLimit.find(option=>option.key==='dexterity').reason,str:maximum.find(option=>option.key==='strength').reason};
  });assert.deepEqual(result.keys,['strength','constitution','dexterity','power','charisma']);assert.match(result.missing,/initial DEX/);assert.match(result.dex,/maximum/);assert.match(result.str,/maximum/);
},true));
test('unresolved seasons and characteristic changes block application before any write',async()=>fixture(async page=>{
  await setupSeasonActor(page);
  await page.evaluate(()=>{draft.seasons=[{id:'earth',season:'Earth',choice:'pending',stat:null,start:null}];draft.training={initialDex:15,speciesMaximum:21};});
  await prepareApplyFixture(page);
  const pending=await page.evaluate(async()=>{try{await api.applyProgression(actor);return false;}catch{return writes.length===0&&itemWrites.length===0;}});
  assert.equal(pending,true);
  const changed=await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user),stat=snap.characteristics.strength;
    draft.seasons[0]={id:'earth',season:'Earth',choice:'stat',stat:'strength',start:{...stat}};
    const loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,draft,snap,game.user,loaded.fingerprint,'chosen-stat');
    actor.system.characteristics.strength.value++;
    try{await api.applyProgression(actor);return false;}catch(error){return /changed/.test(error.message)&&writes.length===0&&itemWrites.length===0;}
  });assert.equal(changed,true);
},true));
test('switching a season away from TP exposes overspending and rejects save',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user);
    draft.amounts.tp=0;draft.seasons=[{id:'earth',season:'Earth',choice:'tp',stat:null,start:null}];draft.training={initialDex:null,speciesMaximum:null};
    api.validatePlayerDraft(draft,snap);draft.seasons[0].choice='pending';
    try{api.validatePlayerDraft(draft,snap);return false;}catch(error){return /exceeded/.test(error.message);}
  });assert.equal(result,true);
},true));
test('resource cards align, title is doubled, and the supplied actor resolves exactly the Fyrdman pack',async()=>fixture(async page=>{
  const exportPath=process.env.KORONIL_TEST_EXPORT;
  if(exportPath){
  const data=JSON.parse(readFileSync(exportPath,'utf8'));
  const ids=await page.evaluate(data=>{
    const imported={...actor,items:data.items.map(item=>({...item,id:item._id}))};
    return api.readPlayerActor(imported,game.user).styles.map(group=>({name:group.name,members:group.members,issues:group.issues}));
  },data);
  assert.deepEqual(ids,[{name:'Combat Style (Fyrdman)',members:['YDwZ78s92mC2m81c','0PEOE9vjh7ih7h7h','WXVcyRFwB4WkPPUP','e44oSloPBxC1pTSl'],issues:[]}]);
  }
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial; background:#eee; color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});
  await combatFixture(page);
  await page.evaluate(async()=>{await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});
  await assignBudgets(page,{xp:1,tp:1,dp:0});
  await page.locator('[data-add=fyrd]').click();await page.locator('[data-entry=fyrd] [data-allocate=xp]').check();await page.locator('[data-entry=fyrd] [data-allocate=tp]').check();
  const dimensions=await page.evaluate(()=>({cards:[...document.querySelectorAll('[data-screen=progression] [data-resource]')].map(card=>{const rect=card.getBoundingClientRect();return {top:rect.top,width:rect.width,height:rect.height,overflow:card.scrollWidth>card.clientWidth};}),title:parseFloat(getComputedStyle(document.querySelector('.kp-manager-title')).fontSize)}));
  assert.ok(dimensions.cards.every(card=>Math.abs(card.top-dimensions.cards[0].top)<1&&!card.overflow&&card.height<=100));assert.ok(Math.abs(dimensions.title-57.6)<.2);
  await page.evaluate(()=>{document.querySelector('[data-screen=progression]').scrollTop=0;});
  await page.screenshot({path:new URL('../../analysis/Compagnon_Manager_DM_v081.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
},true));
async function combatFixture(page) {
  await page.evaluate(()=>{
    const add=(id,name,base,gained,mod,tick=true)=>actor.items.push({id,name,type:'skill',system:{baseChance:base,gainedChance:gained,categoryMod:mod,chance:base+gained+mod,category:'meleeWeapons',hasExperience:tick,canGetExperience:true}});
    add('fyrd','Combat Style (Fyrdman)',0,59,5);
    for(const [index,name]of api.combatPacks.Fyrdman.entries())add(`member${index}`,name.replace(/\)$/,' - Fyrdman)'),5+index*5,20,index===1?10:5);
    const snap=api.readPlayerActor(actor,game.user,'gm'),row=snap.rows.find(row=>row.id==='fyrd');
    globalThis.draft=api.submittedPlayerDraft({amounts:{xp:1,tp:1,dp:0},entries:[{itemId:row.id,name:row.name,type:'skill',xp:1,tp:1,direction:'add',start:api.baseline(row)}]},snap);
  });
}
test('combat style includes its four skills, previews equal full values and PC saves notes only',async()=>fixture(async page=>{
  await combatFixture(page);
  await page.evaluate(async()=>{Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'combat-ui-request',configurable:true});game.user={id:'player',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  await assignBudgets(page,{xp:1,tp:1,dp:0});
  await page.locator('[data-add=fyrd]').click();
  assert.equal(await page.locator('[data-entry]').count(),5);
  assert.equal(await page.locator('[data-entry=member0] [data-allocate=xp]').isDisabled(),true);
  await page.locator('[data-entry=fyrd] [data-allocate=xp]').check();
  await page.locator('[data-entry=fyrd] [data-allocate=tp]').check();
  assert.deepEqual(await page.locator('[data-new-value]').allTextContents(),['70 %','70 %','70 %','70 %','70 %']);
  const before=await page.evaluate(()=>JSON.stringify(actor.items));
  await page.locator('[data-save]').click();
  assert.deepEqual(await page.evaluate(()=>errors),['Request saved to notes. No progression values were applied.']);
  await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  const saved=await page.evaluate(()=>({items:JSON.stringify(actor.items),saved:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user))}));
  assert.equal(saved.items,before);assert.equal(saved.saved.format,4);assert.equal(saved.saved.draft.entries.length,5);
  assert.equal(saved.saved.draft.entries.reduce((sum,entry)=>sum+entry.xp+entry.tp,0),2);
  await page.locator('[data-entry=member1] [data-remove]').click();
  assert.equal(await page.locator('[data-entry]').count(),0);
},true));
test('DM synchronizes every combat member with different bases and bonuses, clears every tick, and resumes safely',async()=>fixture(async page=>{
  await combatFixture(page);await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    failItemAt=3;let interrupted=false;try{await api.applyProgression(actor);}catch{interrupted=true;}
    const retained=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft.entries.length;
    failItemAt=0;const tx=await api.applyProgression(actor);
    return {interrupted,retained,changes:tx.plan.changes.length,values:actor.items.filter(item=>item.id==='fyrd'||item.id.startsWith('member')).map(item=>[item.system.chance,item.system.hasExperience,item.system.gainedChance]),history:api.transactionStore(actor).history.length,empty:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft.entries.length};
  });
  assert.equal(result.interrupted,true);assert.equal(result.retained,5);assert.equal(result.changes,5);
  assert.deepEqual(result.values,[[70,false,65],[70,false,60],[70,false,50],[70,false,50],[70,false,45]]);
  assert.equal(result.history,1);assert.equal(result.empty,0);
},true));
test('missing or ambiguous combat members block allocation and styles cannot receive points twice through members',async()=>fixture(async page=>{
  await combatFixture(page);
  const result=await page.evaluate(()=>{
    const failures=[];const rejects=fn=>{try{fn();return false;}catch{return true;}};
    const snap=api.readPlayerActor(actor,game.user);draft.entries[1].xp=1;draft.amounts.xp=2;
    failures.push(rejects(()=>api.validatePlayerDraft(draft,snap)));draft.entries[1].xp=0;
    actor.items=actor.items.filter(item=>item.id!=='member3');
    const missing=api.readPlayerActor(actor,game.user);failures.push(!api.allocationOptions(missing.rows.find(row=>row.id==='fyrd')).xp,rejects(()=>api.projectedValues(draft,missing)));
    actor.items.push({...actor.items.find(item=>item.id==='member0'),id:'duplicate'});
    const ambiguous=api.readPlayerActor(actor,game.user);failures.push(ambiguous.styles[0].issues.some(issue=>issue.includes('ambiguous')));
    return failures;
  });
  assert.deepEqual(result,[true,true,true,true]);
},true));
test('overlapping combat styles with incompatible full targets are rejected',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const names=new Set([...api.combatPacks.Berserker,...api.combatPacks['Weapon Thegn']]);
    let n=0;for(const name of names)actor.items.push({id:`weapon${n++}`,name,type:'skill',system:{baseChance:5,gainedChance:30,chance:40,categoryMod:5,category:'meleeWeapons',hasExperience:true,canGetExperience:true}});
    for(const [id,name,gained]of [['berserk','Berserker',50],['thegn','Weapon Thegn',60]])actor.items.push({id,name:`Combat Style (${name})`,type:'skill',system:{baseChance:0,gainedChance:gained,chance:gained+5,categoryMod:5,category:'meleeWeapons',hasExperience:true,canGetExperience:true}});
    const snap=api.readPlayerActor(actor,game.user),entries=['berserk','thegn'].map(id=>{const row=snap.rows.find(row=>row.id===id);return {itemId:id,name:row.name,type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(row)};});
    const draft=api.submittedPlayerDraft({amounts:{xp:2,tp:0,dp:0},entries},snap);
    try{api.validatePlayerDraft(draft,snap);return false;}catch(error){return error.message.includes('different values');}
  });assert.equal(result,true);
},true));
async function fixture(run, english = false) {
  const page = await browser.newPage();
  try {
    await page.setContent('<html><head></head><body></body></html>');
    await page.evaluate(code => {
      globalThis.foundry = { applications:{api:{ApplicationV2:class {
        constructor() { this.element = document.createElement('div'); document.body.append(this.element); }
        async _prepareContext() { return {}; }
        async render() { const context=await this._prepareContext({}); this._replaceHTML(await this._renderHTML(context),this.element); this.rendered=true; return this; }
        bringToFront() {}
      }}}};
      globalThis.errors=[];
      globalThis.ui={notifications:{error:m=>errors.push(m),warn:m=>errors.push(m),info:m=>errors.push(m)}};
      globalThis.game={version:'14.367',system:{id:'rqg',version:'6.1.1'},user:{id:'gm',isGM:true}};
      globalThis.writes=[];
      globalThis.actor={id:'a',uuid:'Actor.a',name:'Koronil',type:'character',system:{editMode:false,background:{biography:'<p>Anciennes notes &amp; histoire.</p>'}},items:[
        {id:'scan',name:'Scan',type:'skill',system:{baseChance:25,gainedChance:48,chance:78,categoryMod:5,category:'perception',hasExperience:true,canGetExperience:true}},
        {id:'dance',name:'Dance',type:'skill',system:{baseChance:10,gainedChance:17,chance:37,categoryMod:10,category:'agility',hasExperience:false,canGetExperience:true}},
        {id:'spirit',name:'Spirit Combat',type:'skill',system:{baseChance:20,gainedChance:74,chance:99,categoryMod:5,category:'magic',hasExperience:true,canGetExperience:true}},
        {id:'air',name:'Air',type:'rune',system:{chance:70,runeType:{type:'element'},hasExperience:false}}
      ],testUserPermission:()=>true,canUserModify:()=>true,update:async function(change){writes.push(change);this.system.background.biography=change['system.background.biography'];return this;}};
      game.actors=[actor]; game.actors.get=id=>id===actor.id?actor:null;
      actor.toObject=()=>JSON.parse(JSON.stringify({_id:actor.id,name:actor.name,type:actor.type,system:actor.system,items:actor.items,flags:actor.flags??{},ownership:{default:0}}));
      foundry.utils={saveDataToFile:(json,type,filename)=>{globalThis.exported=JSON.parse(json);globalThis.exportFilename=filename;}};
      globalThis.api=new Function(code+'\nreturn {readActor,readDistribution,writeDistribution,validateDraft,baseline,unitGains,saveDistribution,checkNativeNotesSideEffects,DistributionApplication,parseQuantity,PlayerProgressionApplication,learningMode,allocationOptions,validatePlayerDraft,readPlayerActor,projectedValues,readReadableDistribution,writeReadableDistribution,saveReadableDistribution,submittedPlayerDraft,GMProgressionApplication,exportGMCharacter,requireGM,progressionPlan,applyProgression,transactionStore,combatPacks,selectionGroup,progressionMarkdown,managerProgressionMarkdown,characteristicMarkdown,filterRows,availableAmounts,characteristicOptions,validateSeasonTraining,appendExportHistory,characteristicCost,characteristicRows,characteristicPlan,applyCharacteristics,resumeCharacteristics,dmDossiers,dmPackId,initializeDMPack,migrateDMDossier,loadDMDossier,saveDMDossier,stripDMExportNotes,managerState,emptyDowntime,validateDowntime,privateDowntime,downtimePlan,publishDowntimeActivity,resumeDowntimePublication,verifyDMExchange,resumeDMExchange,saveCharacterReference,characterResyncPlan,applyCharacterResync,resumeCharacterResync,readReferenceExport,convertedTrainingDP,trainingConversionPlan,convertTrainingDP,trainingSkillOptions,trainingProgressionDraft};')();
      globalThis.snapshot=api.readActor(actor,game.user,'gm');
      globalThis.initial=api.readDistribution(actor.system.background.biography,snapshot);
      globalThis.draft={amounts:{xp:2,tp:1,dp:3},entries:[{itemId:'scan',type:'skill',name:'Scan',xp:1,tp:1,direction:'add',start:api.baseline(snapshot.rows.find(r=>r.id==='scan'))}]};
    },english ? englishSource(combined) : combined);
    await setupDMPack(page);
    return await run(page);
  } finally { await page.close(); }
}
async function assignBudgets(page,amounts={xp:2,tp:1,dp:3}) {
  await page.evaluate(async amounts=>{
    const snapshot=api.readPlayerActor(actor,game.user),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot);
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,{amounts,entries:[]},snapshot,{id:'dm',isGM:true},loaded.fingerprint,'dm-assignment');
    app.loadState(snapshot);await app.render();
  },amounts);
}
test('barème boundaries and non-skills TP exclusions', async () => fixture(async page => {
  const result = await page.evaluate(() => [40,41,70,71,75,76,90,91].map(raw=>[raw,api.unitGains({raw,tick:false,type:'skill',name:'Test'}),api.unitGains({raw,tick:true,type:'skill',name:'Test'})]));
  assert.deepEqual(result.map(r=>r[1].xp),[3,2,2,1,1,1,1,null]);
  assert.deepEqual(result.map(r=>r[2].xp),[6,4,4,2,2,2,2,1]);
  assert.deepEqual(result.map(r=>r[1].tp),[3,2,2,2,2,null,null,null]);
  assert.equal(await page.evaluate(()=>api.unitGains({raw:30,tick:true,type:'rune',name:'Air'}).tp),null);
}));
test('save updates only biography, preserves notes and all progression fields, roundtrips editor pre/code',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    const items=JSON.stringify(actor.items),systemMode=actor.system.editMode;
    // crypto.randomUUID requires a secure context in Foundry; fixture supplies a UUID only here.
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'test-revision',configurable:true});
    await api.saveDistribution(actor,game.user,'gm',draft,initial.fingerprint);
    const html=actor.system.background.biography;
    const changed=html.replace(/<pre>/g,'<pre><code>').replace(/<\/pre>/g,'</code></pre>');
    return {keys:Object.keys(writes[0]),originalPreserved:html.startsWith('<p>Anciennes notes &amp; histoire.</p>'),unchanged:items===JSON.stringify(actor.items)&&systemMode===actor.system.editMode,read:api.readDistribution(changed,snapshot).draft};
  });
  assert.deepEqual(result.keys,['system.background.biography']); assert.equal(result.originalPreserved,true); assert.equal(result.unchanged,true);
  assert.deepEqual(result.read.amounts,{xp:2,tp:1,dp:3}); assert.equal(result.read.entries[0].start.raw,73);
}));
test('conflicting revisions are blocked; unrelated notes are preserved at save time',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const first=api.writeDistribution(actor.system.background.biography,draft,snapshot,game.user,initial.fingerprint,'one');
    const loaded=api.readDistribution(first,snapshot);
    const unrelated=first+'<p>Nouvelle note du MJ.</p>';
    const merged=api.writeDistribution(unrelated,draft,snapshot,game.user,loaded.fingerprint,'two');
    let blocked=false;try{api.writeDistribution(merged,draft,snapshot,game.user,loaded.fingerprint,'three');}catch{blocked=true;}
    return {blocked,preserved:merged.endsWith('<p>Nouvelle note du MJ.</p>')};
  });
  assert.deepEqual(result,{blocked:true,preserved:true});
}));
test('notes can be saved over HTTP without crypto.randomUUID',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true});
    foundry.utils={randomID:()=> 'http-revision'};
    return (await api.saveDistribution(actor,game.user,'gm',draft,initial.fingerprint)).revision;
  });
  assert.equal(result,'http-revision');
}));
test('damaged, duplicate, wrong actor and unknown schema blocks are rejected without mutation',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const html=api.writeDistribution(actor.system.background.biography,draft,snapshot,game.user,initial.fingerprint,'one');
    const cases=[html+html,html.replace('[KORONIL-PROGRESSION:POINTS:END]','broken'),html.replaceAll('Actor.a','Actor.b'),html.replaceAll('&quot;version&quot;: 1','&quot;version&quot;: 2'),html.replace('&quot;amounts&quot;:', '&quot;unexpected&quot;:')];
    return cases.map(value=>{try{api.readDistribution(value,snapshot);return false;}catch{return true;}});
  });
  assert.deepEqual(result,[true,true,true,true,true]);
}));
test('overspend, negative/fractional quantities, impossible TP and changed start values are blocked',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const fail=fn=>{try{fn();return false;}catch{return true;}};
    const checks=[fail(()=>api.parseQuantity('-1')),fail(()=>api.parseQuantity('1.5')),fail(()=>api.validateDraft({...draft,amounts:{xp:0,tp:0,dp:0}},snapshot)),fail(()=>api.validateDraft({...draft,entries:[...draft.entries,...draft.entries]},snapshot))];
    const spirit=snapshot.rows.find(r=>r.id==='spirit');
    checks.push(fail(()=>api.validateDraft({...draft,entries:[{itemId:'spirit',name:spirit.name,type:'skill',xp:0,tp:1,direction:'add',start:api.baseline(spirit)}]},snapshot)));
    actor.items[0].system.gainedChance++;
    checks.push(fail(()=>api.validateDraft(draft,api.readActor(actor,game.user,'gm'))));
    return checks;
  });
  assert.deepEqual(result,[true,true,true,true,true,true]);
}));
test('observer cannot save; trusted non-GM cannot use MJ save',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    const player={id:'p',isGM:false,isTrusted:true};actor.canUserModify=()=>false;
    const checks=[];
    for(const role of ['player','gm']){try{await api.saveDistribution(actor,player,role,draft,initial.fingerprint);checks.push(false);}catch{checks.push(true);}}
    return {checks,writes:writes.length};
  });
  assert.deepEqual(result,{checks:[true,true],writes:0});
}));
test('native RQG automatic Dodge/Jump correction prevents the notes write',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    actor.system.characteristics={dexterity:{value:14}};
    actor.getBestEmbeddedDocumentByRqid=rqid=>rqid==='i.skill.dodge'?{name:'Dodge',_source:{system:{baseChance:27}}}:null;
    let blocked=false;try{await api.saveDistribution(actor,game.user,'gm',draft,initial.fingerprint);}catch(error){blocked=error.message.includes('recalculer');}
    actor.getBestEmbeddedDocumentByRqid=rqid=>rqid==='i.skill.dodge'?{name:'Dodge',_source:{system:{baseChance:28}}}:null;
    let matched=true;try{api.checkNativeNotesSideEffects(actor);}catch{matched=false;}
    return {blocked,matched,writes:writes.length};
  });
  assert.deepEqual(result,{blocked:true,matched:true,writes:0});
}));
test('an invalid edit cannot silently revert to an old valid value after refresh',async()=>fixture(async page=>{
  await page.evaluate(async()=>{globalThis.app=new api.DistributionApplication({role:'gm',actorId:'a'});await app.render();});
  await page.locator('[data-budget=xp]').fill('1.5');
  assert.equal(await page.locator('[data-save]').isDisabled(),true);
  await page.evaluate(async()=>{await app.render();});
  assert.equal(await page.locator('[data-save]').isDisabled(),true);
  await page.locator('[data-budget=xp]').fill('2');
  assert.equal(await page.locator('[data-save]').isDisabled(),false);
}));
test('application budgets, allocation, save and reopening via the MJ share persisted wishes',async()=>fixture(async page=>{
  await page.evaluate(async()=>{Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'ui-revision',configurable:true});globalThis.app=new api.DistributionApplication({role:'gm',actorId:'a'});await app.render();});
  await page.locator('[data-budget=xp]').fill('2'); await page.locator('[data-budget=tp]').fill('1');await page.locator('[data-budget=dp]').fill('3');
  await page.locator('[data-item]').selectOption('scan');await page.locator('[data-add-xp]').fill('1');await page.locator('[data-add-tp]').fill('1'); await page.locator('[data-add]').click();
  assert.equal(await page.locator('[data-entry]').count(),1);
  await page.locator('[data-save]').click();
  await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent.startsWith('Souhaits chargés'));
  assert.equal(await page.locator('[data-budget=dp]').inputValue(),'3');
  const counts=await page.evaluate(async()=>{await app.render();return {entries:app.states.get('a').draft.entries.length,writes:writes.length,errors};});
  assert.equal(counts.entries,1);assert.equal(counts.writes,1);
  assert.equal(counts.errors.some(m=>m.includes('enregistrés')),true);
}));
test('player learning modes enforce native study-only, thresholds and one-point limits',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const row={name:'Skill',type:'skill',raw:75,tick:false,canGetExperience:true};
    const modes=[api.allocationOptions(row),api.allocationOptions({...row,raw:76}),api.allocationOptions({...row,raw:91}),api.allocationOptions({...row,raw:91,tick:true}),api.allocationOptions({...row,raw:60,canGetExperience:false}),api.allocationOptions({...row,raw:76,canGetExperience:false})];
    const copy=JSON.parse(JSON.stringify(draft));copy.entries[0].xp=2;
    let multipleBlocked=false;try{api.validatePlayerDraft(copy,snapshot);}catch{multipleBlocked=true;}
    actor.items[0].system.canGetExperience=false;
    let studyBlocked=false;try{api.validatePlayerDraft(draft,api.readActor(actor,game.user,'player'));}catch{studyBlocked=true;}
    return {modes,multipleBlocked,studyBlocked};
  });
  assert.deepEqual(result.modes,[{xp:true,tp:true,mode:'Normal'},{xp:true,tp:false,mode:'Exp. only'},{xp:false,tp:false,mode:'Imp. only'},{xp:true,tp:false,mode:'Imp. only'},{xp:false,tp:true,mode:'Study only'},{xp:false,tp:false,mode:'Study only'}]);
  assert.equal(result.multipleBlocked,true);assert.equal(result.studyBlocked,true);
},true));
test('English player interface filters categories, shows raw/full and allocates via checkboxes only',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'player-ui-revision',configurable:true});
    game.user={id:'player',isGM:false};
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });
  await assignBudgets(page);
  await page.locator('[data-category]').selectOption('perception');
  assert.equal(await page.locator('[data-browser] tr').count(),1);
  assert.match(await page.locator('[data-browser]').innerText(),/Scan.*73 %.*78 %.*Normal/s);
  await page.locator('[data-add=scan]').click();
  assert.equal(await page.locator('[data-entries] input[type=number]').count(),0);
  assert.equal(await page.locator('[data-add-xp],[data-add-tp]').count(),0);
  await page.locator('[data-allocate=xp]').check();await page.locator('[data-allocate=tp]').check();
  assert.equal(await page.locator('[data-resource]').count(),3);
  assert.equal(await page.locator('[data-used=xp]').innerText(),'1');
  assert.equal(await page.locator('[data-remaining=xp]').innerText(),'1');
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  const saved=await page.evaluate(()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'player')).draft);
  assert.equal(saved.entries[0].xp,1);assert.equal(saved.entries[0].tp,1);
  await page.locator('[data-type]').selectOption('rune');
  assert.match(await page.locator('[data-browser]').innerText(),/Air/);
  assert.equal(await page.locator('[data-category]').inputValue(),'');
},true));
test('unavailable XP/TP checkboxes are disabled; old multi-point requests remain intact and cannot save',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    actor.items[1].system.canGetExperience=false;
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });
  await assignBudgets(page);
  await page.locator('[data-add=dance]').click();
  assert.equal(await page.locator('[data-entry=dance] [data-allocate=xp]').isDisabled(),true);
  assert.equal(await page.locator('[data-entry=dance] [data-allocate=tp]').isDisabled(),false);
  await page.locator('[data-add=spirit]').click();
  assert.equal(await page.locator('[data-entry=spirit] [data-allocate=xp]').isDisabled(),false);
  assert.equal(await page.locator('[data-entry=spirit] [data-allocate=tp]').isDisabled(),true);
  await page.evaluate(async()=>{
    draft.entries[0].xp=2;
    actor.system.background.biography=api.writeDistribution('<p>Anciennes notes &amp; histoire.</p>',draft,snapshot,game.user,initial.fingerprint,'legacy');
    app.loadState(api.readActor(actor,game.user,'player'));await app.render();
  });
  assert.equal(await page.locator('[data-save]').isDisabled(),true);
  assert.match(await page.locator('[data-error]').innerText(),/at most one XP and one TP/);
  assert.equal(await page.evaluate(()=>api.readDistribution(actor.system.background.biography,snapshot).draft.entries[0].xp),2);
},true));
async function prepareApplyFixture(page) {
  await page.evaluate(()=>{
    let counter=0;
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=>`transaction-${++counter}`,configurable:true});
    globalThis.itemWrites=[];globalThis.failItemAt=0;globalThis.failCleanup=false;
    actor.flags={};
    for(const item of actor.items)item._source={system:JSON.parse(JSON.stringify(item.system))};
    actor.update=async function(changes) {
      if(failCleanup&&changes['system.background.biography']!==undefined&&changes['flags.world.companionManager']?.active===null)throw new Error('Simulated cleanup failure');
      writes.push(JSON.parse(JSON.stringify(changes)));
      for(const [path,value]of Object.entries(changes)) {
        const parts=path.split('.');let target=this;
        for(const key of parts.slice(0,-1)){target[key]??={};target=target[key];}
        const finalKey=parts.at(-1);if(finalKey.startsWith('-='))delete target[finalKey.slice(2)];else target[finalKey]=JSON.parse(JSON.stringify(value));
      }
      return this;
    };
    actor.updateEmbeddedDocuments=async function(type,updates) {
      itemWrites.push(JSON.parse(JSON.stringify(updates)));
      if(failItemAt===itemWrites.length)throw new Error('Simulated item failure');
      for(const patch of updates) {
        const item=this.items.find(item=>item.id===patch._id);
        for(const [path,value]of Object.entries(patch))if(path.startsWith('system.')){item.system[path.slice(7)]=value;item._source.system[path.slice(7)]=value;}
        if(item.type==='skill')item.system.chance=item.system.baseChance+item.system.gainedChance+(item.system.categoryMod??0);
        if(item.type==='rune'&&patch['system.chance']!==undefined) {
          const other=this.items.find(other=>other.flags?.rqg?.documentRqidFlags?.id===item.system.opposingRuneRqidLink?.rqid);
          if(other){other.system.chance=100-item.system.chance;other._source.system.chance=other.system.chance;}
        }
      }
      return updates;
    };
    const snap=api.readPlayerActor(actor,game.user,'gm');
    const loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,draft,snap,game.user,loaded.fingerprint,'assigned-request');
  });
}
test('DM apply verifies gains, consumes allocated ticks, archives unused points and clears notes once',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const tx=await api.applyProgression(actor);
    let repeatedBlocked=false;try{await api.applyProgression(actor);}catch{repeatedBlocked=true;}
    return {skill:actor.items[0].system,notes:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft,history:actor.flags.world.companionManager.history.length,remaining:tx.plan.balances.remaining,repeatedBlocked,base:actor.items[0].system.baseChance};
  });
  assert.equal(result.skill.gainedChance,52);assert.equal(result.skill.chance,82);assert.equal(result.skill.hasExperience,false);assert.equal(result.base,25);
  assert.deepEqual(result.notes,{amounts:{xp:0,tp:0,dp:0},entries:[]});assert.equal(result.history,1);assert.deepEqual(result.remaining,{xp:1,tp:0,dp:3});assert.equal(result.repeatedBlocked,true);
},true));
test('an interrupted update resumes absolute targets without applying the first gain twice',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const row=snap.rows.find(row=>row.id==='dance');
    const two={amounts:{xp:2,tp:1,dp:0},entries:[...loaded.draft.entries,{itemId:row.id,name:row.name,type:row.type,xp:1,tp:0,direction:'add',start:api.baseline(row)}]};
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,two,snap,game.user,loaded.fingerprint,'two-skills');
    failItemAt=2;let failed=false;try{await api.applyProgression(actor);}catch{failed=true;}
    const partial={scan:actor.items[0].system.gainedChance,active:api.transactionStore(actor).active.status,amounts:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.amounts};
    failItemAt=0;await api.applyProgression(actor);
    return {failed,partial,scan:actor.items[0].system.gainedChance,dance:actor.items[1].system.gainedChance,history:api.transactionStore(actor).history.length};
  });
  assert.equal(result.failed,true);assert.equal(result.partial.scan,52);assert.equal(result.partial.active,'needs-recovery');assert.deepEqual(result.partial.amounts,{xp:2,tp:1,dp:0});
  assert.equal(result.scan,52);assert.equal(result.dance,20);assert.equal(result.history,1);
},true));
test('cleanup failure retains points and wishes; resume only finishes cleanup',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    failCleanup=true;let failed=false;try{await api.applyProgression(actor);}catch{failed=true;}
    const pending=api.transactionStore(actor).active,firstCount=itemWrites.length;
    failCleanup=false;await api.applyProgression(actor);
    return {failed,pending:pending.status,firstCount,finalCount:itemWrites.length,gained:actor.items[0].system.gainedChance,history:api.transactionStore(actor).history.length};
  });
  assert.equal(result.failed,true);assert.equal(result.pending,'needs-recovery');assert.equal(result.firstCount,result.finalCount);assert.equal(result.gained,52);assert.equal(result.history,1);
},true));
test('linked runes apply combined targets with singleton updates and keep the unspent companion tick',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    for(const [id,chance,other]of [['fertility',50,'death'],['death',50,'fertility']])actor.items.push({id,name:id,type:'rune',flags:{rqg:{documentRqidFlags:{id:`i.rune.${id}`}}},system:{chance,hasExperience:true,canGetExperience:true,runeType:{type:'power'},opposingRuneRqidLink:{rqid:`i.rune.${other}`}},_source:{system:{chance,hasExperience:true}}});
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const entries=['fertility','death'].map(id=>{const row=snap.rows.find(row=>row.id===id);return {itemId:id,name:row.name,type:'rune',xp:id==='fertility'?1:0,tp:0,direction:'add',start:api.baseline(row)};});
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,{amounts:{xp:1,tp:0,dp:0},entries},snap,game.user,loaded.fingerprint,'runes');
    await api.applyProgression(actor);
    return {fertility:actor.items.find(i=>i.id==='fertility').system,death:actor.items.find(i=>i.id==='death').system,singletons:itemWrites.every(writes=>writes.length===1)};
  });
  assert.equal(result.fertility.chance,54);assert.equal(result.death.chance,46);assert.equal(result.fertility.hasExperience,false);assert.equal(result.death.hasExperience,true);assert.equal(result.singletons,true);
},true));
test('PC cannot edit assigned budgets or apply; assignment survives a player request save',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const player={id:'player',isGM:false};game.user=player;
    const snap=api.readPlayerActor(actor,player),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const tampered=JSON.parse(JSON.stringify(loaded.draft));tampered.amounts.xp++;
    let budgetBlocked=false,applyBlocked=false;
    try{await api.saveReadableDistribution(actor,player,'player',tampered,loaded.fingerprint);}catch{budgetBlocked=true;}
    try{await api.applyProgression(actor,player);}catch{applyBlocked=true;}
    await api.saveReadableDistribution(actor,player,'player',loaded.draft,loaded.fingerprint);
    const saved=api.readReadableDistribution(actor.system.background.biography,snap);
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
    return {budgetBlocked,applyBlocked,origin:saved.origin,budgetsDisabled:[...app.element.querySelectorAll('[data-budget]')].every(input=>input.disabled),noApply:!app.element.querySelector('[data-apply]')};
  });
  assert.deepEqual(result,{budgetBlocked:true,applyBlocked:true,origin:'GM declaration',budgetsDisabled:true,noApply:true});
},true));
test('DM apply confirmation can be cancelled and post-update export contains the updated sheet',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  await page.evaluate(async()=>{
    globalThis.confirmResult=false;globalThis.confirmPrompt='';foundry.applications.api.DialogV2={confirm:async options=>{confirmPrompt=options.content;return confirmResult;}};
    await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
  });
  await page.locator('[data-apply]').click();assert.equal(await page.evaluate(()=>itemWrites.length),0);
  assert.match(await page.evaluate(()=>confirmPrompt),/Have you exported a backup/);
  await page.locator('[data-export-after]').check();await page.evaluate(()=>{confirmResult=true;});await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>globalThis.exported?.actor?.items?.[0]?.system.gainedChance===52);
  const result=await page.evaluate(()=>({gained:exported.actor.items[0].system.gainedChance,complete:exported.dossier.flags.world.companionManagerDM.progression.history[0].status,filename:exportFilename}));
  assert.equal(result.gained,52);assert.equal(result.complete,'complete');assert.match(result.filename,/\d{8}T\d{9}Z\.json$/);
},true));
test('a changed request after confirmation is rejected before any item write',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const plan=api.progressionPlan(actor),snap=api.readPlayerActor(actor,game.user,'gm');
    const changed=JSON.parse(JSON.stringify(draft));changed.amounts.xp=3;
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,changed,snap,game.user,plan.fingerprint,'changed-request');
    let blocked=false;try{await api.applyProgression(actor,game.user,plan.fingerprint);}catch(error){blocked=error.message.includes('after confirmation');}
    return {blocked,itemWrites:itemWrites.length,active:api.transactionStore(actor).active};
  });
  assert.deepEqual(result,{blocked:true,itemWrites:0,active:null});
},true));
test('PC budget editing is disabled even when the PC macro is opened by the DM',async()=>fixture(async page=>{
  await page.evaluate(async()=>{globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  assert.equal(await page.locator('[data-budget=xp]').isDisabled(),true);
  assert.equal(await page.locator('[data-budget=tp]').isDisabled(),true);
  assert.equal(await page.locator('[data-budget=dp]').isDisabled(),true);
},true));
test('player table headers stay visible when the skill list scrolls',async()=>fixture(async page=>{
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:css});
  await page.evaluate(async()=>{
    for(let n=0;n<45;n++)actor.items.push({id:`extra${n}`,name:`Skill ${n}`,type:'skill',system:{baseChance:10,gainedChance:5,chance:25,category:'agility',hasExperience:false,canGetExperience:true}});
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
    app.element.className='koronil-progression kp-player-v04';app.element.style.height='800px';
  });
  const result=await page.evaluate(()=>{
    const scroller=document.querySelector('.kp-browser .kp-scrolling-body'),head=document.querySelector('.kp-browser .kp-fixed-head th');
    const before=head.getBoundingClientRect().top;scroller.scrollTop=180;
    return {delta:head.getBoundingClientRect().top-before,scroll:scroller.scrollTop};
  });
  assert.equal(result.scroll,180);assert.ok(Math.abs(result.delta)<2);
},true));
test('new value updates live using initial raw gains and current full modifiers',async()=>fixture(async page=>{
  await page.evaluate(async()=>{globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();});
  await assignBudgets(page);
  await page.locator('[data-add=scan]').click();
  assert.equal(await page.locator('[data-entry=scan] [data-new-value]').innerText(),'78 %');
  await page.locator('[data-entry=scan] [data-allocate=xp]').check();
  assert.equal(await page.locator('[data-entry=scan] [data-new-value]').innerText(),'80 %');
  await page.locator('[data-entry=scan] [data-allocate=tp]').check();
  assert.equal(await page.locator('[data-entry=scan] [data-new-value]').innerText(),'82 %');
  assert.equal(await page.locator('[data-entry=scan] [data-new-value]').getAttribute('title'),'New raw: 77 %');
},true));
test('opposed rune pair is selected, previews both impacts, saves and reloads the zero-cost companion',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    for(const [id,name,chance,other]of [['fertility','Fertility',50,'death'],['death','Death',50,'fertility']])actor.items.push({id,name,type:'rune',flags:{rqg:{documentRqidFlags:{id:`i.rune.${id}`}}},system:{chance,canGetExperience:true,hasExperience:false,runeType:{type:'power'},opposingRuneRqidLink:{rqid:`i.rune.${other}`}}});
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'rune-request',configurable:true});
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });
  await assignBudgets(page);await page.locator('[data-type]').selectOption('rune');
  await page.locator('[data-add=fertility]').click();
  assert.equal(await page.locator('[data-entry]').count(),2);
  await page.locator('[data-entry=fertility] [data-allocate=xp]').check();
  assert.equal(await page.locator('[data-entry=fertility] [data-new-value]').innerText(),'52 %');
  assert.equal(await page.locator('[data-entry=death] [data-new-value]').innerText(),'48 %');
  await page.locator('[data-entry=fertility] [data-direction]').selectOption('subtract');
  assert.equal(await page.locator('[data-entry=fertility] [data-new-value]').innerText(),'48 %');
  assert.equal(await page.locator('[data-entry=death] [data-new-value]').innerText(),'52 %');
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  assert.equal(await page.locator('[data-entry]').count(),2);
  const stored=await page.evaluate(()=>({html:actor.system.background.biography,draft:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft,values:actor.items.filter(item=>item.type==='rune').map(item=>item.system.chance)}));
  assert.equal(stored.draft.entries.length,2);assert.equal(stored.draft.entries.reduce((s,e)=>s+e.xp,0),1);assert.equal(stored.html.includes('<pre>'),false);
  assert.deepEqual(stored.values,[70,50,50]);
  await page.locator('[data-entry=death] [data-remove]').click();assert.equal(await page.locator('[data-entry]').count(),0);
},true));
test('readable notes replace legacy JSON only on save, preserve outside notes and reject edited totals',async()=>fixture(async page=>{
  const result=await page.evaluate(()=>{
    const snap=api.readPlayerActor(actor,game.user);
    const legacy=api.writeDistribution(actor.system.background.biography,draft,snap,game.user,initial.fingerprint,'old');
    const loaded=api.readReadableDistribution(legacy,snap);
    const html=api.writeReadableDistribution(legacy+'<p>Keep this note.</p>',loaded.draft,snap,game.user,loaded.fingerprint,'new');
    const parsed=api.readReadableDistribution(html,snap);
    let rejected=false;try{api.readReadableDistribution(html.replace('<td>82 %</td>','<td>83 %</td>'),snap);}catch{rejected=true;}
    const editor=html.replaceAll('<td>','<td><p>').replaceAll('</td>','</p></td>');
    return {readback:parsed.draft,human:!html.includes('<pre>'),preserved:html.startsWith('<p>Anciennes notes &amp; histoire.</p>')&&html.endsWith('<p>Keep this note.</p>'),rejected,editor:api.readReadableDistribution(editor,snap).draft.entries.length};
  });
  assert.equal(result.readback.entries[0].itemId,'scan');assert.equal(result.readback.entries[0].xp,1);assert.equal(result.readback.entries[0].tp,1);
  assert.deepEqual(result.readback.entries[0].start,{raw:73,base:25,gained:48,tick:true});
  assert.equal(result.human,true);assert.equal(result.preserved,true);assert.equal(result.rejected,true);assert.equal(result.editor,1);
},true));
test('clear all requires confirmation, keeps budgets and updates notes only after save',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'clear-request',configurable:true});
    globalThis.confirmResult=false;globalThis.confirmCalls=[];
    foundry.applications.api.DialogV2={confirm:async options=>{confirmCalls.push(options);return confirmResult;}};
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
  });
  assert.equal(await page.locator('[data-clear-all]').isDisabled(),true);
  await assignBudgets(page);
  await page.locator('[data-add=scan]').click();await page.locator('[data-entry=scan] [data-allocate=xp]').check();
  await page.locator('[data-add=dance]').click();await page.locator('[data-entry=dance] [data-allocate=xp]').check();
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  await page.locator('[data-clear-all]').click();
  assert.equal(await page.locator('[data-entry]').count(),2);
  assert.equal(await page.evaluate(()=>confirmCalls[0].no.default),true);
  await page.evaluate(()=>{confirmResult=null;});await page.locator('[data-clear-all]').click();
  assert.equal(await page.locator('[data-entry]').count(),2);
  await page.evaluate(()=>{confirmResult=true;});await page.locator('[data-clear-all]').click();
  assert.equal(await page.locator('[data-entry]').count(),0);assert.equal(await page.locator('[data-clear-all]').isDisabled(),true);
  assert.equal(await page.locator('[data-budget=xp]').inputValue(),'2');assert.equal(await page.locator('[data-budget=tp]').inputValue(),'1');assert.equal(await page.locator('[data-budget=dp]').inputValue(),'3');
  const beforeSave=await page.evaluate(()=>({writes:writes.length,entries:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft.entries.length}));
  assert.deepEqual(beforeSave,{writes:1,entries:2});
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=2&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  const afterSave=await page.evaluate(()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user)).draft);
  assert.deepEqual(afterSave,{amounts:{xp:2,tp:1,dp:3},entries:[],seasons:[],training:{initialDex:null,speciesMaximum:null}});
},true));
test('GM loads readable player notes and saves a correction that the player can reload',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    Object.defineProperty(globalThis.crypto,'randomUUID',{value:()=> 'gm-request',configurable:true});
    const snap=api.readPlayerActor(actor,game.user);
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,{amounts:draft.amounts,entries:[]},snap,game.user,initial.fingerprint,'dm-assignment');
    const assigned=api.readReadableDistribution(actor.system.background.biography,snap);
    actor.system.background.biography=api.writeReadableDistribution(actor.system.background.biography,draft,snap,{id:'player',isGM:false},assigned.fingerprint,'player-request');
    actor.testUserPermission=()=>false;
    await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
  });
  assert.equal(await page.locator('[data-entry=scan]').count(),1);
  assert.equal(await page.locator('[data-entry=scan] [data-new-value]').innerText(),'82 %');
  assert.equal(await page.locator('[data-export]').count(),1);
  await page.locator('[data-entry=scan] [data-allocate=tp]').uncheck();
  await page.locator('[data-save]').click();await page.waitForFunction(()=>writes.length>=1&&!app.states.get(actor.id).dirty&&document.querySelector('[data-state]').textContent==='Request loaded from character notes.');
  const saved=await page.evaluate(()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'player')).draft);
  assert.equal(saved.entries[0].xp,1);assert.equal(saved.entries[0].tp,0);assert.equal(saved.amounts.tp,1);
},true));
test('DM export logs its timestamped reference privately without saving the draft or touching actor notes',async()=>fixture(async page=>{
  await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
  });
  await page.locator('[data-budget=xp]').fill('2');await page.locator('[data-add=scan]').click();await page.locator('[data-entry=scan] [data-allocate=xp]').check();
  await page.locator('[data-export]').click();
  await page.waitForFunction(()=>Boolean(globalThis.exported));
  const result=await page.evaluate(()=>({count:exported.actor.items.length,notes:exported.actor.system.background.biography,liveNotes:actor.system.background.biography,writes:writes.length,original:actor.items[0].system.gainedChance,notifications:errors,log:exported.dossier.flags.world.companionManagerDM.exports}));
  assert.equal(result.count,4);assert.equal(result.notes,result.liveNotes);assert.equal(result.notes.includes('POINTS'),false);assert.equal(result.writes,0);assert.equal(result.original,48);
  assert.doesNotMatch(result.notes,/Export history/);assert.equal(result.log[0].phase,'Before application');
  assert.equal(result.log[0].filename,await page.evaluate(()=>exportFilename));
  assert.equal(result.notifications.some(message=>message.includes('Check your browser downloads')),true);
  assert.match(await page.evaluate(()=>exportFilename),/\d{8}T\d{9}Z\.json$/);
},true));
test('only GM can open or export; revocation is rechecked and the player UI has no export button',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    actor.exportToJSON=()=>{globalThis.exportCalls=(globalThis.exportCalls??0)+1;};
    game.user={id:'trusted',isGM:false,isTrusted:true};
    let constructorBlocked=false,exportBlocked=false;
    try{new api.GMProgressionApplication({actorId:'a'});}catch{constructorBlocked=true;}
    try{await api.exportGMCharacter(actor,game.user);}catch{exportBlocked=true;}
    const playerApp=new api.PlayerProgressionApplication({actorId:'a'});await playerApp.render();
    const playerExport=playerApp.element.querySelector('[data-export]')!==null;
    game.user={id:'gm',isGM:true};await api.initializeDMPack();await api.migrateDMDossier(actor);writes.length=0;globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='progression';await app.render();
    playerApp.element.remove();game.user.isGM=false;
    return {constructorBlocked,exportBlocked,playerExport};
  });
  assert.deepEqual(result,{constructorBlocked:true,exportBlocked:true,playerExport:false});
  await page.locator('[data-export]').click();
  assert.equal(await page.evaluate(()=>globalThis.exportCalls??0),0);
  assert.equal(await page.evaluate(()=>errors.at(-1)), 'This interface is restricted to the GM.');
},true));
test('before and after export references survive PC saves and progression cleanup',async()=>fixture(async page=>{
  await prepareApplyFixture(page);
  const result=await page.evaluate(async()=>{
    const before=await api.exportGMCharacter(actor);
    let snapshot=api.readPlayerActor(actor,game.user),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot);
    await api.saveReadableDistribution(actor,{id:'pc',isGM:false},'player',loaded.draft,loaded.fingerprint);
    const tx=await api.applyProgression(actor);
    const beforePreserved=actor.system.background.biography.includes(before);
    const after=await api.exportGMCharacter(actor,game.user,'After application');
    snapshot=api.readPlayerActor(actor,game.user);loaded=api.readReadableDistribution(actor.system.background.biography,snapshot);
    const doc=new DOMParser().parseFromString(actor.system.background.biography,'text/html');
    return {before,after,beforePreserved,liveNotes:actor.system.background.biography,snapshotNotes:exported.system.background.biography,headings:[...doc.querySelectorAll('h3')].filter(node=>node.textContent==='Compagnon Manager — Export history').length,entries:loaded.draft.entries.length,amounts:loaded.draft.amounts,status:tx.status};
  });
  assert.equal(result.beforePreserved,true);assert.ok(result.liveNotes.includes(result.before)&&result.liveNotes.includes(result.after));
  assert.match(result.liveNotes,/Before application/);assert.match(result.liveNotes,/After application/);assert.equal(result.headings,1);
  assert.equal(result.snapshotNotes,result.liveNotes);assert.equal(result.entries,0);assert.deepEqual(result.amounts,{xp:0,tp:0,dp:0});assert.equal(result.status,'complete');
},true));
test('failed export does not record a successful reference or change progression',async()=>fixture(async page=>{
  const result=await page.evaluate(async()=>{
    const notes=actor.system.background.biography,items=JSON.stringify(actor.items);
    foundry.utils.saveDataToFile=()=>{throw new Error('Download unavailable');};
    let blocked=false;try{await api.exportGMCharacter(actor);}catch(error){blocked=error.message==='Download unavailable';}
    return {blocked,sameNotes:notes===actor.system.background.biography,sameItems:items===JSON.stringify(actor.items),writes:writes.length};
  });assert.deepEqual(result,{blocked:true,sameNotes:true,sameItems:true,writes:0});
},true));
async function setupDowntime(page) {
  await setupCharacteristicActor(page);
  await page.evaluate(async()=>{
    await api.initializeDMPack();await api.migrateDMDossier(actor);
    const snapshot=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snapshot);
    draft={amounts:{xp:0,tp:0,dp:5},entries:[],seasons:[],training:{initialDex:15,speciesMaximum:21},downtime:{activities:[],requests:[{id:'project1',title:'Find a spirit',type:'asset',description:'Seek a friendly spirit.\nOffer a pact.',dp:2,revision:null}]}};
    await api.saveReadableDistribution(actor,game.user,'gm',draft,loaded.fingerprint);
  });
}
test('downtime DP-only cycle preserves private secrets, publishes a readable result and accumulates only new investments',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'project1',{required:6,showRequired:false,response:'A promising lead.',secret:'SECRET SPIRIT',status:'open'},read().fingerprint);
    const hidden=read().draft.downtime.activities[0],first=await api.applyProgression(actor),afterFirst=read();
    const next=structuredClone(afterFirst.draft);next.amounts.dp=3;next.downtime.requests=[{id:'project1',title:hidden.title,type:hidden.type,description:hidden.description,dp:3,revision:next.downtime.activities[0].revision}];
    await api.saveReadableDistribution(actor,game.user,'gm',next,afterFirst.fingerprint);
    await api.applyProgression(actor);
    await api.publishDowntimeActivity(actor,'project1',{required:6,showRequired:true,response:'The spirit responds.',secret:'SECRET SPIRIT',status:'open'},read().fingerprint);
    await api.exportGMCharacter(actor,game.user);
    return {hidden,firstInvested:afterFirst.draft.downtime.activities[0].invested,firstAmounts:afterFirst.draft.amounts,summary:first.plan.markdownSummary,final:read().draft.downtime,private:api.privateDowntime(actor),actorSecret:JSON.stringify(actor.toObject()).includes('SECRET SPIRIT'),backupSecret:JSON.stringify(exported).includes('SECRET SPIRIT'),nativeWrites:itemWrites.length,history:api.transactionStore(actor).history.length};
  });
  assert.equal(result.hidden.required,null);assert.equal(result.hidden.invested,0);assert.equal(result.firstInvested,2);assert.deepEqual(result.firstAmounts,{xp:0,tp:0,dp:0});assert.match(result.summary,/2 DPs.*Find a spirit/);assert.equal(result.final.activities[0].invested,5);assert.equal(result.final.activities[0].required,6);assert.equal(result.final.requests.length,0);assert.equal(result.private.activities[0].secret,'SECRET SPIRIT');assert.equal(result.actorSecret,false);assert.equal(result.backupSecret,true);assert.equal(result.nativeWrites,0);assert.equal(result.history,2);
},true));
test('downtime rejects invalid proposals and forged shared progress before spending points',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const saved=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),original=saved.draft;
    const failures=[];for(const change of [d=>d.downtime.requests[0].dp=-1,d=>d.downtime.requests[0].dp=1.5,d=>d.downtime.requests[0].dp=6,d=>d.downtime.requests.push({...d.downtime.requests[0]}),d=>d.downtime.requests[0].revision='missing',d=>d.downtime.requests[0].secret='forged']){const copy=structuredClone(original);change(copy);try{api.validateDowntime(copy);failures.push(false);}catch{failures.push(true);}}
    await api.publishDowntimeActivity(actor,'project1',{required:1,showRequired:false,secret:'hidden'},saved.fingerprint);
    try{api.progressionPlan(actor);failures.push(false);}catch{failures.push(true);}
    return {failures,invested:api.privateDowntime(actor).activities[0].invested,wishes:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.downtime.requests.length};
  });assert.deepEqual(result.failures,Array(7).fill(true));assert.equal(result.invested,0);assert.equal(result.wishes,1);
},true));
test('downtime application retries cleanup without investing the same DP twice',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const normal=actor.update;let failed=false;actor.update=async patch=>{if(!failed&&patch['system.background.biography']){failed=true;throw Error('Interrupted DP cleanup');}return normal.call(actor,patch);};
    let interrupted=false;try{await api.applyProgression(actor);}catch{interrupted=true;}
    const before=api.privateDowntime(actor).activities[0].invested;
    await api.applyProgression(actor);
    return {interrupted,before,after:api.privateDowntime(actor).activities[0].invested,history:api.transactionStore(actor).history.length,requests:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.downtime.requests.length};
  });assert.deepEqual(result,{interrupted:true,before:2,after:2,history:1,requests:0});
},true));
test('interrupted downtime publication can recover and blocks unrelated progression',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),normal=actor.update;let failed=false;
    actor.update=async patch=>{if(!failed&&patch['system.background.biography']){failed=true;throw Error('Interrupted publish');}return normal.call(actor,patch);};
    let interrupted=false,blocked=false;try{await api.publishDowntimeActivity(actor,'project1',{required:9,showRequired:false,response:'PUBLIC',secret:'PRIVATE'},loaded.fingerprint);}catch{interrupted=true;}
    try{api.progressionPlan(actor);}catch{blocked=true;}
    await api.resumeDowntimePublication(actor);
    return {interrupted,blocked,pending:!!api.dmDossiers.get(actor.uuid).data.downtimePending,active:actor.flags.world.companionManager.active,public:actor.system.background.biography.includes('PUBLIC'),secret:actor.system.background.biography.includes('PRIVATE'),invested:api.privateDowntime(actor).activities[0].invested};
  });assert.deepEqual(result,{interrupted:true,blocked:true,pending:false,active:false,public:true,secret:false,invested:0});
},true));
test('PC activity form saves only wishes; DM editor publishes response and application validates DP',async()=>fixture(async page=>{
  await setupDowntime(page);
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');
  await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});
  await page.evaluate(async()=>{game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});app.screen='downtime';await app.render();});
  await page.locator('[data-new-activity]').click();await page.locator('[data-request-form] [name=title]').fill('Study spirits');await page.locator('[data-request-form] [name=type]').selectOption('training');await page.locator('[data-training-skill]').selectOption('dance');await page.locator('[data-request-form] [name=description]').fill('Improve my understanding.');await page.locator('[data-request-form] button[type=submit]').click();
  assert.equal(await page.locator('[data-used=dp]').textContent(),'3');await page.locator('[data-save]').click();await page.waitForFunction(()=>!app.states.get('a').dirty);
  assert.equal(await page.evaluate(()=>api.dmDossiers.get(actor.uuid).data.downtime.activities.length),0);
  await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});await page.screenshot({path:'analysis/downtime-pc-v0.11.0.png',fullPage:true});
  await page.evaluate(async()=>{game.user={id:'gm',isGM:true};globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='downtime';document.body.replaceChildren(app.element);await app.render();});
  await page.locator('[data-activity=project1] [data-dm-details]').click();await page.locator('[data-dm-activity-form] [name=required]').fill('5');await page.locator('[data-dm-activity-form] [name=response]').fill('Visit the shrine.');await page.locator('[data-dm-activity-form] [name=secret]').fill('PRIVATE TEST');
  await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:950px;width:1000px;padding:16px;box-sizing:border-box';});await page.screenshot({path:'analysis/downtime-dm-v0.11.0.png',fullPage:true});
  await page.locator('[data-dm-activity-form] button[type=submit]').click();await page.waitForFunction(()=>!app.downtimeEditor);
  assert.equal(await page.evaluate(()=>api.privateDowntime(actor).activities[0].invested),0);assert.equal(await page.locator('[data-activity=project1]').textContent().then(s=>s.includes('Visit the shrine.')),true);
  await page.evaluate(async()=>{await api.applyProgression(actor);await app.refresh();});
  assert.equal(await page.locator('[data-activity=project1]').textContent().then(s=>s.includes('DP invested: 2')),true);
  assert.equal(await page.evaluate(()=>actor.system.background.biography.includes('PRIVATE TEST')),false);
},true));

test('PC cannot forge published downtime data; invested type and closed activities are protected',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'project1',{required:5,showRequired:false,secret:'PRIVATE'},read().fingerprint);
    const loaded=read(),forged=structuredClone(loaded.draft);forged.downtime.activities[0].invested=99;let blocked=false;
    try{await api.saveReadableDistribution(actor,{id:'pc',isGM:false},'player',forged,loaded.fingerprint);}catch{blocked=true;}
    const fake=structuredClone(loaded.draft);fake.downtime.activities[0].invested=99;let canonicalBlocked=false;try{api.downtimePlan(actor,fake);}catch{canonicalBlocked=true;}
    await api.applyProgression(actor);let after=read(),entry=after.draft.downtime.activities[0],copy=structuredClone(after.draft);copy.amounts.dp=1;copy.downtime.requests=[{id:entry.id,title:entry.title,type:'training',description:'other',dp:1,revision:entry.revision}];let typeBlocked=false;try{api.validateDowntime(copy);}catch{typeBlocked=true;}
    await api.publishDowntimeActivity(actor,'project1',{status:'complete'},after.fingerprint);after=read();entry=after.draft.downtime.activities[0];copy=structuredClone(after.draft);copy.amounts.dp=1;copy.downtime.requests=[{id:entry.id,title:entry.title,type:entry.type,description:entry.description,dp:1,revision:entry.revision}];let closedBlocked=false;try{api.validateDowntime(copy);}catch{closedBlocked=true;}
    let roleBlocked=false;game.user={id:'pc',isGM:false};try{api.privateDowntime(actor);}catch{roleBlocked=true;}
    return {blocked,canonicalBlocked,typeBlocked,closedBlocked,roleBlocked};
  });assert.deepEqual(result,{blocked:true,canonicalBlocked:true,typeBlocked:true,closedBlocked:true,roleBlocked:true});
},true));
test('downtime publication unlock failure remains recoverable after private details are saved',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),normal=actor.update;let failed=false;
    actor.update=async patch=>{if(!failed&&patch['flags.world.companionManager.active']===false){failed=true;throw Error('Unlock failure');}return normal.call(actor,patch);};
    let interrupted=false;try{await api.publishDowntimeActivity(actor,'project1',{response:'Saved response'},loaded.fingerprint);}catch{interrupted=true;}
    const before=actor.flags.world.companionManager.active;await api.resumeDowntimePublication(actor);
    return {interrupted,before,after:actor.flags.world.companionManager.active,response:api.privateDowntime(actor).activities[0].response};
  });assert.deepEqual(result,{interrupted:true,before:true,after:false,response:'Saved response'});
},true));

test('DM downtime compendium pages contain complete data and move activities between Active Completed and Failed',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'project1',{required:5,showRequired:false,response:'Public lead',secret:'Hidden ritual'},read().fingerprint);
    await api.applyProgression(actor);
    const doc=api.dmDossiers.get(actor.uuid).document,page=name=>doc.pages.find(p=>p.name===name).text.content;
    const active=page('Downtime — Active');
    await api.publishDowntimeActivity(actor,'project1',{status:'complete',response:'Found the spirit'},read().fingerprint);
    const completed={active:page('Downtime — Active'),page:page('Downtime — Completed')};
    await api.publishDowntimeActivity(actor,'project1',{status:'failed',response:'The pact failed'},read().fingerprint);
    await api.loadDMDossier(actor);await api.exportGMCharacter(actor,game.user);
    const final={active:page('Downtime — Active'),completed:page('Downtime — Completed'),failed:page('Downtime — Failed')};
    const snapshot=read();game.user={id:'pc',isGM:false};const pc=new api.PlayerProgressionApplication({actorId:'a'});pc.screen='downtime';pc.downtimeStatusFilter='failed';await pc.render();
    return {active,completed,final,stored:doc.flags.world.companionManagerDM.downtime.activities[0],public:snapshot.draft.downtime.activities[0],proposalDisabled:pc.element.querySelector('[data-propose]').disabled,secretInActor:JSON.stringify(actor.toObject()).includes('Hidden ritual'),backup:exported.dossier.pages.find(p=>p.name==='Downtime — Failed').text.content};
  });
  for(const text of ['Find a spirit','Acquire asset','DP invested: 2','DP required: 5','Hidden ritual','Public lead','Investment history','project1'])assert.ok(result.active.includes(text),text);
  assert.doesNotMatch(result.completed.active,/Find a spirit/);assert.match(result.completed.page,/Found the spirit/);assert.match(result.completed.page,/Hidden ritual/);
  assert.doesNotMatch(result.final.completed,/Find a spirit/);assert.match(result.final.failed,/Failed/);assert.match(result.final.failed,/The pact failed/);assert.match(result.final.failed,/Hidden ritual/);assert.equal(result.stored.status,'failed');assert.equal(result.stored.invested,2);assert.equal(result.public.status,'failed');assert.equal(result.public.required,null);assert.equal(result.secretInActor,false);assert.equal(result.proposalDisabled,true);assert.match(result.backup,/Hidden ritual/);
},true));
test('existing compendium dossiers gain three downtime pages once without altering private free notes or canonical activities',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const loaded=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'project1',{secret:'Saved secret'},loaded.fingerprint);
    const doc=api.dmDossiers.get(actor.uuid).document;
    doc.pages=doc.pages.filter(p=>!['Downtime — Active','Downtime — Completed','Downtime — Failed'].includes(p.name));
    doc.pages.find(p=>p.name==='Downtime — DM').text.content='<p>Original private notes</p>';
    const before=JSON.stringify(doc.flags.world.companionManagerDM.downtime),notes=actor.system.background.biography;
    await api.loadDMDossier(actor);await api.loadDMDossier(actor);
    return {counts:['Downtime — Active','Downtime — Completed','Downtime — Failed'].map(name=>doc.pages.filter(p=>p.name===name).length),canonicalPreserved:JSON.stringify(doc.flags.world.companionManagerDM.downtime)===before,notesUnchanged:actor.system.background.biography===notes,privateNotes:doc.pages.find(p=>p.name==='Downtime — DM').text.content,activity:doc.pages.find(p=>p.name==='Downtime — Active').text.content};
  });assert.deepEqual(result.counts,[1,1,1]);assert.equal(result.canonicalPreserved,true);assert.equal(result.notesUnchanged,true);assert.equal(result.privateNotes,'<p>Original private notes</p>');assert.match(result.activity,/Saved secret/);
},true));

test('downtime status filter defaults to active in both managers and never changes saved activities or DP proposals',async()=>fixture(async page=>{
  await setupDowntime(page);
  await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.applyProgression(actor);
    let saved=read(),draft=saved.draft;draft.amounts.dp=3;draft.downtime.requests=['completed','failed','cancelled'].map(id=>({id,title:id,type:'project',description:'Test activity',dp:0,revision:null}));
    await api.saveReadableDistribution(actor,game.user,'gm',draft,saved.fingerprint);await api.applyProgression(actor);
    for(const [id,status]of [['completed','complete'],['failed','failed'],['cancelled','cancelled']])await api.publishDowntimeActivity(actor,id,{status},read().fingerprint);
    saved=read();draft=saved.draft;draft.amounts.dp=2;draft.downtime.requests=[{id:'new-request',title:'New pending activity',type:'training',description:'Training goal',dp:1,revision:null}];await api.saveReadableDistribution(actor,game.user,'gm',draft,saved.fingerprint);
    globalThis.filterNotes=actor.system.background.biography;
  });
  for(const role of ['player','gm']) {
    await page.evaluate(async role=>{game.user={id:role,isGM:role==='gm'};globalThis.app=role==='gm'?new api.GMProgressionApplication({actorId:'a'}):new api.PlayerProgressionApplication({actorId:'a'});app.screen='downtime';document.body.replaceChildren(app.element);await app.render();},role);
    assert.equal(await page.locator('[data-downtime-status]').inputValue(),'open');
    assert.deepEqual(await page.locator('[data-activity]:visible').evaluateAll(cards=>cards.map(c=>c.dataset.activity)),['project1','new-request']);
    for(const [status,ids]of [['complete',['completed']],['failed',['failed']],['cancelled',['cancelled']],['all',['project1','completed','failed','cancelled','new-request']]]) {
      await page.locator('[data-downtime-status]').selectOption(status);
      assert.deepEqual(await page.locator('[data-activity]:visible').evaluateAll(cards=>cards.map(c=>c.dataset.activity)),ids);
      assert.equal(await page.locator('[data-used=dp]').textContent(),'1');
    }
    await page.evaluate(async()=>{await app.refresh();});assert.equal(await page.locator('[data-downtime-status]').inputValue(),'all');
    assert.equal(await page.evaluate(()=>actor.system.background.biography===filterNotes&&!app.states.get('a').dirty),true);
    await page.locator('[data-downtime-status]').selectOption('failed');await page.locator('[data-new-activity]').click();assert.equal(await page.locator('[data-downtime-status]').inputValue(),'open');assert.equal(await page.locator('[data-request-form]').isVisible(),true);
  }
},true));

test('PC exchange saves only WISHES while DM published points and private synchronization remain untouched',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const blocks=html=>{const first=html.indexOf('<p>[KORONIL-PROGRESSION:POINTS:BEGIN]</p>'),end=html.indexOf('<p>[KORONIL-PROGRESSION:POINTS:END]</p>')+'<p>[KORONIL-PROGRESSION:POINTS:END]</p>'.length;return html.slice(first,end);};
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap),grant=loaded.draft;grant.amounts.xp=1;grant.seasons=[{id:'sync-season',season:'Earth',choice:'pending',stat:null,start:null}];
    await api.saveReadableDistribution(actor,game.user,'gm',grant,loaded.fingerprint);
    const before={points:blocks(actor.system.background.biography),private:JSON.stringify(api.dmDossiers.get(actor.uuid).data),writes:dossierWrites,reads:packReads,native:JSON.stringify({items:actor.items,stats:actor.system.characteristics})};
    game.user={id:'pc',isGM:false};const pc=api.readPlayerActor(actor,game.user,'player'),saved=api.readReadableDistribution(actor.system.background.biography,pc),request=saved.draft;
    request.entries=[{itemId:'scan',name:'Scan',type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(pc.rows.find(row=>row.id==='scan'))}];request.seasons[0].choice='tp';request.downtime.requests[0].dp=3;
    const after=await api.saveReadableDistribution(actor,game.user,'player',request,saved.fingerprint);
    const result={format:after.format,pointsEqual:before.points===blocks(actor.system.background.biography),privateEqual:before.private===JSON.stringify(api.dmDossiers.get(actor.uuid).data),dossierWrites:dossierWrites-before.writes,packReads:packReads-before.reads,nativeEqual:before.native===JSON.stringify({items:actor.items,stats:actor.system.characteristics}),choices:after.draft.seasons[0].choice,dp:after.draft.downtime.requests[0].dp,author:after.requestAuthor,sharedSame:after.sharedRevision===saved.sharedRevision,requestChanged:after.revision!==saved.revision};
    game.user={id:'gm',isGM:true};api.verifyDMExchange(actor);await api.applyProgression(actor);api.verifyDMExchange(actor);return result;
  });assert.deepEqual(result,{format:6,pointsEqual:true,privateEqual:true,dossierWrites:0,packReads:0,nativeEqual:true,choices:'tp',dp:3,author:'pc',sharedSame:true,requestChanged:true});
},true));
test('interrupted DM synchronization resumes its two records without replacing unrelated notes',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const saved=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),draft=saved.draft;draft.amounts.dp=8;
    const normal=actor.update;let fail=true;actor.update=async patch=>{if(fail&&patch['system.background.biography']){fail=false;throw Error('Interrupted DM publication');}return normal.call(actor,patch);};
    let interrupted=false;try{await api.saveReadableDistribution(actor,game.user,'gm',draft,saved.fingerprint);}catch{interrupted=true;}
    let blocked=false;try{api.progressionPlan(actor);}catch{blocked=true;}
    actor.system.background.biography='<p>New unrelated journal note.</p>'+actor.system.background.biography;
    await api.resumeDMExchange(actor);api.verifyDMExchange(actor);
    const after=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    return {interrupted,blocked,dp:after.draft.amounts.dp,pending:!!api.dmDossiers.get(actor.uuid).data.synchronizationPending,locked:actor.flags.world.companionManager.active,unrelated:actor.system.background.biography.includes('New unrelated journal note.'),sameRevision:after.sharedRevision===api.dmDossiers.get(actor.uuid).data.synchronization.revision};
  });assert.deepEqual(result,{interrupted:true,blocked:true,dp:8,pending:false,locked:false,unrelated:true,sameRevision:true});
},true));
test('private DM synchronization detects altered published budgets and stale PC requests before applying',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const html=actor.system.background.biography,original=api.readReadableDistribution(html,api.readPlayerActor(actor,game.user,'gm'));
    actor.system.background.biography=html.replace('<td>DP</td><td>5</td>','<td>DP</td><td>50</td>');let forged=false;try{api.progressionPlan(actor);}catch{forged=true;}
    actor.system.background.biography=html;
    const draft=original.draft;draft.amounts.dp=6;await api.saveReadableDistribution(actor,game.user,'gm',draft,original.fingerprint);
    game.user={id:'pc',isGM:false};let stale=false;try{await api.saveReadableDistribution(actor,game.user,'player',original.draft,original.fingerprint);}catch{stale=true;}
    const valid=actor.system.background.biography,doc=new DOMParser().parseFromString(valid,'text/html'),tables=[...doc.querySelectorAll('table')];tables.at(-1).rows[1].cells[0].textContent='obsolete-revision';let badLink=false;try{api.readReadableDistribution(doc.body.innerHTML,api.readPlayerActor(actor,game.user,'player'));}catch{badLink=true;}
    return {forged,stale,badLink,nativeWrites:itemWrites.length};
  });assert.deepEqual(result,{forged:true,stale:true,badLink:true,nativeWrites:0});
},true));

test('DM upgrades legacy exchange notes preserving wishes seasons and private downtime information',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const snap=api.readPlayerActor(actor,game.user,'gm'),loaded=api.readReadableDistribution(actor.system.background.biography,snap);
    const legacy=api.writeReadableDistribution(actor.system.background.biography,loaded.draft,{...snap,privateManager:false},game.user,loaded.fingerprint,'legacy-v011');
    actor.system.background.biography=legacy;await api.saveDMDossier(actor,{synchronization:null});
    const before=api.readReadableDistribution(legacy,snap),privateBefore=JSON.stringify(api.privateDowntime(actor));
    await api.migrateDMDossier(actor);api.verifyDMExchange(actor);
    const after=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    return {before:before.format,after:after.format,requests:after.draft.downtime.requests,privateSame:privateBefore===JSON.stringify(api.privateDowntime(actor)),budgets:after.draft.amounts,link:after.sharedRevision===api.dmDossiers.get(actor.uuid).data.synchronization.revision};
  });assert.equal(result.before,5);assert.equal(result.after,6);assert.equal(result.requests[0].title,'Find a spirit');assert.equal(result.requests[0].dp,2);assert.equal(result.privateSame,true);assert.deepEqual(result.budgets,{xp:0,tp:0,dp:5});assert.equal(result.link,true);
},true));
async function setupReferenceActor(page) {
  await setupDowntime(page);
  await page.evaluate(async()=>{
    const clone=x=>JSON.parse(JSON.stringify(x));actor.effects=[];actor.ownership={default:0,pc:3};actor.folder='party';
    const itemSource=item=>{const {_source,id,...saved}=item;return {...clone(saved),_id:id??saved._id};};
    actor.toObject=function(){return clone({_id:this.id,name:this.name,type:this.type,system:this.system,items:this.items.map(itemSource),effects:this.effects.map(itemSource),flags:this.flags,ownership:this.ownership,folder:this.folder});};
    actor.deleteEmbeddedDocuments=async function(type,ids){const key=type==='Item'?'items':'effects';this[key]=this[key].filter(item=>!ids.includes(item.id??item._id));return ids;};
    actor.createEmbeddedDocuments=async function(type,documents){const key=type==='Item'?'items':'effects';const created=documents.map(doc=>({...clone(doc),id:doc._id,_source:{system:clone(doc.system??{})}}));this[key].push(...created);return created;};
    actor.updateEmbeddedDocuments=async function(type,documents,options){if(globalThis.failReferenceItem){globalThis.failReferenceItem=false;throw Error('Interrupted reference item restore');}const key=type==='Item'?'items':'effects';for(const doc of documents){const item=this[key].find(item=>(item.id??item._id)===doc._id);if(options?.recursive===false){for(const [name,value]of Object.entries(doc))if(name!=='_id')item[name]=clone(value);item._source={system:clone(item.system??{})};}else for(const [name,value]of Object.entries(doc))if(name.startsWith('system.')){item.system[name.slice(7)]=value;item._source.system[name.slice(7)]=value;}}return documents;};
    await api.saveDMDossier(actor,{characterBackups:[],characterReference:null});await api.saveCharacterReference(actor,'Initial complete reference');
  });
}
test('complete compendium reference restores character native fields items effects and private data while preserving world identity and access',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const result=await page.evaluate(async()=>{
    const id=api.dmDossiers.get(actor.uuid).data.characterReference;
    actor.items[0].system.gainedChance=60;actor.items[0]._source.system.gainedChance=60;actor.system.characteristics.strength.value=18;actor.items.push({id:'extra',name:'Extra skill',type:'skill',system:{baseChance:0,gainedChance:10,chance:10,categoryMod:0,category:'perception',hasExperience:false,canGetExperience:true}});actor.effects.push({id:'effect-extra',name:'Extra effect',type:'base',system:{}});
    await api.saveDMDossier(actor,{progression:{...api.transactionStore(actor),statTicks:{power:9}}});
    actor.system.background.biography=actor.system.background.biography.replace('<td>DP</td><td>5</td>','<td>DP</td><td>99</td>');
    const plan=api.characterResyncPlan(actor,{referenceId:id});await api.applyCharacterResync(actor,plan);api.verifyDMExchange(actor);
    const saved=api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')),data=api.dmDossiers.get(actor.uuid).data;
    return {scan:actor.items[0].system.gainedChance,strength:actor.system.characteristics.strength.value,extra:actor.items.some(i=>i.id==='extra'),effects:actor.effects.length,ticks:api.transactionStore(actor).statTicks?.power??0,requests:saved.draft.downtime.requests.length,dp:saved.draft.amounts.dp,owner:actor.ownership,folder:actor.folder,actorId:actor.id,pending:!!data.resynchronizationPending,beforeStored:data.characterBackups.some(b=>b.reason==='Before forced resynchronization'&&b.actor.system.characteristics.strength.value===18),referenceStored:data.characterBackups.some(b=>b.id===data.characterReference&&b.actor.system.characteristics.strength.value===11)};
  });assert.deepEqual(result,{scan:48,strength:11,extra:false,effects:0,ticks:0,requests:0,dp:5,owner:{default:0,pc:3},folder:'party',actorId:'a',pending:false,beforeStored:true,referenceStored:true});
},true));
test('DM accepts a changed sheet as new reference and formatting-only changes do not trigger a false mismatch',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const result=await page.evaluate(async()=>{
    actor.system.background.biography=actor.system.background.biography.replaceAll('<table>','<table class="editor-table">');let formattingOkay=true;try{api.verifyDMExchange(actor);}catch{formattingOkay=false;}
    actor.items[0].system.gainedChance=55;actor.items[0]._source.system.gainedChance=55;actor.items[0].system.chance=85;
    actor.system.background.biography=actor.system.background.biography.replace('<td>DP</td><td>5</td>','<td>DP</td><td>8</td>');
    let mismatch=true;try{api.verifyDMExchange(actor);mismatch=false;}catch{}
    await api.applyCharacterResync(actor,api.characterResyncPlan(actor,{mode:'sheet'}));api.verifyDMExchange(actor);
    const data=api.dmDossiers.get(actor.uuid).data,current=data.characterBackups.find(b=>b.id===data.characterReference);
    return {formattingOkay,mismatch,scan:actor.items[0].system.gainedChance,dp:api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).draft.amounts.dp,referenceScan:current.actor.items.find(i=>i._id==='scan').system.gainedChance,history:data.characterBackups.length};
  });assert.deepEqual(result,{formattingOkay:true,mismatch:true,scan:55,dp:8,referenceScan:55,history:3});
},true));
test('native and full DM JSON exports resynchronize the reference and reject another character or unfinished source',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const result=await page.evaluate(async()=>{
    const original=actor.toObject();original.items.find(i=>i._id==='scan').system.gainedChance=52;original.items.find(i=>i._id==='scan').system.chance=82;
    let wrong=false;try{api.readReferenceExport(actor,{...original,_id:'other'});}catch{wrong=true;}
    await api.applyCharacterResync(actor,api.characterResyncPlan(actor,{mode:'export',exportData:original}));
    await api.saveDMDossier(actor,{progression:{...api.transactionStore(actor),statTicks:{power:6}}});
    await api.exportGMCharacter(actor,game.user);const backup=structuredClone(exported);
    actor.items[0].system.gainedChance=62;await api.saveDMDossier(actor,{progression:{...api.transactionStore(actor),statTicks:{power:1}}});
    await api.applyCharacterResync(actor,api.characterResyncPlan(actor,{mode:'export',exportData:backup}));api.verifyDMExchange(actor);
    const unfinished=structuredClone(backup);unfinished.dossier.flags.world.companionManagerDM.synchronizationPending={};let blocked=false;try{api.readReferenceExport(actor,unfinished);}catch{blocked=true;}
    return {wrong,blocked,scan:actor.items[0].system.gainedChance,ticks:api.transactionStore(actor).statTicks.power,owner:actor.ownership.pc};
  });assert.deepEqual(result,{wrong:true,blocked:true,scan:52,ticks:6,owner:3});
},true));
test('interrupted reference restore resumes absolute targets and stale previews and player access are rejected',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const result=await page.evaluate(async()=>{
    actor.items[0].system.gainedChance=60;let plan=api.characterResyncPlan(actor),stale=false;actor.name='Changed name';try{await api.applyCharacterResync(actor,plan);}catch{stale=true;}actor.name='Koronil';
    plan=api.characterResyncPlan(actor);globalThis.failReferenceItem=true;let interrupted=false;try{await api.applyCharacterResync(actor,plan);}catch{interrupted=true;}
    await api.resumeCharacterResync(actor);api.verifyDMExchange(actor);
    let denied=false;game.user={id:'pc',isGM:false};try{api.characterResyncPlan(actor);}catch{denied=true;}
    return {stale,interrupted,denied,scan:actor.items[0].system.gainedChance,pending:!!api.dmDossiers.get(actor.uuid).data.resynchronizationPending,locked:actor.flags.world.companionManager.active};
  });assert.deepEqual(result,{stale:true,interrupted:true,denied:true,scan:48,pending:false,locked:false});
},true));

test('Summary can preview and cancel a restore then repair damaged exchange notes by accepting the current sheet',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  await page.evaluate(async()=>{globalThis.confirmResult=false;foundry.applications.api.DialogV2={confirm:async()=>confirmResult};globalThis.app=new api.GMProgressionApplication({actorId:'a'});await app.render();globalThis.referenceCount=api.dmDossiers.get(actor.uuid).data.characterBackups.length;globalThis.referenceSource=JSON.stringify(actor.toObject());});
  await page.locator('[data-preview-reference]').click();assert.equal(await page.evaluate(()=>JSON.stringify(actor.toObject())===referenceSource&&api.dmDossiers.get(actor.uuid).data.characterBackups.length===referenceCount),true);
  await page.evaluate(async()=>{actor.system.background.biography=actor.system.background.biography.replace('<td>Format</td><td>6</td>','<td>Format</td><td>99</td>');await app.refresh();confirmResult=true;});
  assert.equal(await page.locator('[data-reference-mode]').count(),1);
  await page.locator('[data-reference-mode]').selectOption('sheet');await page.locator('[data-preview-reference]').click();
  await page.waitForFunction(()=>!app.states.get('a').error&&!api.dmDossiers.get(actor.uuid).data.resynchronizationPending);
  assert.equal(await page.evaluate(()=>{api.verifyDMExchange(actor);return api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm')).format;}),6);
},true));
test('DM imports a native export through the Summary file chooser and stores its complete reference',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const exported=await page.evaluate(()=>{const data=actor.toObject();data.system.characteristics.strength.value=12;data.items.find(i=>i._id==='scan').system.gainedChance=50;data.items.find(i=>i._id==='scan').system.chance=80;return JSON.stringify(data);});
  await page.evaluate(async()=>{foundry.applications.api.DialogV2={confirm:async()=>true};globalThis.app=new api.GMProgressionApplication({actorId:'a'});await app.render();});
  await page.locator('[data-reference-mode]').selectOption('export');await page.locator('[data-import-reference]').setInputFiles({name:'Koronil native.json',mimeType:'application/json',buffer:Buffer.from(exported)});await page.locator('[data-preview-reference]').click();
  await page.waitForFunction(()=>actor.system.characteristics.strength.value===12&&!api.dmDossiers.get(actor.uuid).data.resynchronizationPending);
  assert.equal(await page.evaluate(()=>actor.items[0].system.gainedChance),50);
  const css=['progression.css','distribution.css','player.css'].map(name=>readFileSync(new URL(`../koronil-progression/styles/${name}`,import.meta.url),'utf8')).join('\n');await page.addStyleTag({content:`body {font:16px Arial;background:#eee;color:#222;} input,button,select {font:inherit;box-sizing:border-box;} ${css}`});await page.evaluate(()=>{app.element.className='koronil-progression kp-player-v04';app.element.style.cssText='height:1000px;width:1100px;padding:16px;box-sizing:border-box';document.querySelector('[data-screen=summary]').scrollTop=document.querySelector('.kp-reference-manager').offsetTop;});await page.screenshot({path:'analysis/reference-manager-v0.13.0.png',fullPage:true});
},true));
test('complete character snapshots use five FIFO entries without nesting backups and stay private from the PC',async()=>fixture(async page=>{
  await setupReferenceActor(page);
  const result=await page.evaluate(async()=>{
    const doc=api.dmDossiers.get(actor.uuid).document;doc.pages.find(p=>p.name==='Private notes').text.content='<p>SECRET dossier</p>';
    for(let i=0;i<7;i++){actor.items[0].system.gainedChance=50+i;actor.items[0].system.chance=80+i;await api.saveCharacterReference(actor,'Manual '+i);}
    const data=api.dmDossiers.get(actor.uuid).data,refs=data.characterBackups;game.user={id:'pc',isGM:false};let denied=false;try{await api.saveCharacterReference(actor);}catch{denied=true;}
    globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});await app.render();
    return {count:refs.length,reasons:refs.map(b=>b.reason),current:refs.at(-1).id===data.characterReference,nesting:refs.some(b=>b.privateData.characterBackups),secretActor:JSON.stringify(actor.toObject()).includes('SECRET dossier'),secretRefs:refs.every(b=>b.pages.some(p=>p.content.includes('SECRET dossier'))),denied,pcButton:app.element.querySelector('[data-preview-reference]')!==null};
  });assert.deepEqual(result,{count:5,reasons:['Manual 2','Manual 3','Manual 4','Manual 5','Manual 6'],current:true,nesting:false,secretActor:false,secretRefs:true,denied:true,pcButton:false});
},true));

test('pending Completed schedules private closure and applies targeted Training before publishing Completed',async()=>fixture(async page=>{
  await setupTargetedTraining(page,{xp:true});
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    await api.publishDowntimeActivity(actor,'target1',{status:'complete'},read().fingerprint);
    const scheduled=structuredClone(api.privateDowntime(actor).activities[0]),publicBefore=read().draft.downtime.activities[0];
    const tx=await api.applyProgression(actor),after=api.privateDowntime(actor).activities[0],loaded=read();
    const page=api.dmDossiers.get(actor.uuid).document.pages.find(p=>p.name==='Downtime — Completed').text.content;
    return {scheduled,publicBefore,status:after.status,flag:after.completeOnApply,invested:after.invested,converted:api.convertedTrainingDP(after),closures:after.history.filter(e=>e.kind==='completion').length,requests:loaded.draft.downtime.requests.length,publicAfter:loaded.draft.downtime.activities[0],summary:tx.plan.markdownSummary,page};
  });
  assert.equal(result.scheduled.status,'open');assert.equal(result.scheduled.completeOnApply,true);assert.equal(result.scheduled.invested,0);assert.equal(Object.hasOwn(result.publicBefore,'completeOnApply'),false);
  assert.equal(result.status,'complete');assert.equal(result.flag,false);assert.equal(result.invested,1);assert.equal(result.converted,1);assert.equal(result.closures,1);assert.equal(result.requests,0);assert.equal(result.publicAfter.status,'complete');assert.match(result.summary,/\[Completed\]/);assert.match(result.page,/Practice Dance/);
},true));

test('DM editor schedules Completed, allows cancelling or checking closure, and PC keeps only request controls',async()=>fixture(async page=>{
  await setupDowntime(page);
  await page.evaluate(async()=>{globalThis.app=new api.GMProgressionApplication({actorId:'a'});app.screen='downtime';document.body.replaceChildren(app.element);await app.render();});
  await page.locator('[data-dm-details]').click();await page.locator('[name=status]').selectOption('complete');
  assert.equal(await page.locator('[name=completeOnApply]').isChecked(),true);
  await page.locator('[data-dm-activity-form] button[type=submit]').click();await page.waitForFunction(()=>!app.downtimeEditor);
  assert.equal(await page.locator('[data-completion-scheduled]').count(),1);
  await page.locator('[data-dm-details]').click();assert.equal(await page.locator('[name=status]').inputValue(),'open');await page.locator('[name=completeOnApply]').uncheck();
  await page.locator('[data-dm-activity-form] button[type=submit]').click();await page.waitForFunction(()=>!app.downtimeEditor);
  assert.equal(await page.locator('[data-completion-scheduled]').count(),0);
  await page.locator('[data-dm-details]').click();await page.locator('[name=completeOnApply]').check();
  await page.locator('[data-dm-activity-form] button[type=submit]').click();await page.waitForFunction(()=>!app.downtimeEditor);
  await page.evaluate(async()=>{game.user={id:'pc',isGM:false};globalThis.app=new api.PlayerProgressionApplication({actorId:'a'});app.screen='downtime';document.body.replaceChildren(app.element);await app.render();});
  assert.equal(await page.locator('[data-completion-scheduled], [name=completeOnApply], [data-dm-details]').count(),0);
  await page.evaluate(async()=>{game.user={id:'gm',isGM:true};await api.applyProgression(actor);});
  assert.equal(await page.evaluate(()=>api.privateDowntime(actor).activities[0].status),'complete');
},true));

test('scheduled completion resumes cleanup without double investment or duplicate closure and preserves failed-request guard',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    let failedBlocked=false;try{await api.publishDowntimeActivity(actor,'project1',{status:'failed'},read().fingerprint);}catch{failedBlocked=true;}
    await api.publishDowntimeActivity(actor,'project1',{status:'open',completeOnApply:true},read().fingerprint);
    const update=actor.update.bind(actor);let once=false;actor.update=async patch=>{if(!once&&patch['system.background.biography']){once=true;throw Error('Interrupted completion cleanup');}return update(patch);};
    let interrupted=false;try{await api.applyProgression(actor);}catch{interrupted=true;}
    const statusBefore=api.privateDowntime(actor).activities[0].status;await api.applyProgression(actor);
    const activity=api.privateDowntime(actor).activities[0];return {failedBlocked,interrupted,statusBefore,status:activity.status,invested:activity.invested,closures:activity.history.filter(e=>e.kind==='completion').length,requests:read().draft.downtime.requests.length};
  });assert.deepEqual(result,{failedBlocked:true,interrupted:true,statusBefore:'complete',status:'complete',invested:2,closures:1,requests:0});
},true));

test('DM application publishes and backs up every downtime task with mixed statuses investments and targeted Training',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    const read=()=>api.readReadableDistribution(actor.system.background.biography,api.readPlayerActor(actor,game.user,'gm'));
    let saved=read(),draft=structuredClone(saved.draft);
    draft.downtime.requests.push(...['finished','failed'].map(id=>({id,title:id,type:'project',description:'Retained activity',dp:0,revision:null})));
    await api.saveReadableDistribution(actor,game.user,'gm',draft,saved.fingerprint);await api.applyProgression(actor);
    for(const [id,status]of [['finished','complete'],['failed','failed']])await api.publishDowntimeActivity(actor,id,{status,secret:'PRIVATE '+id},read().fingerprint);
    const old=structuredClone(api.privateDowntime(actor).activities.filter(a=>a.id!=='project1'));
    saved=read();draft=structuredClone(saved.draft);const project=draft.downtime.activities.find(a=>a.id==='project1'),row=api.readPlayerActor(actor,game.user,'gm').rows.find(r=>r.id==='dance');
    draft.amounts={xp:0,tp:0,dp:3};draft.downtime.requests=[{id:project.id,title:project.title,type:project.type,description:'Second investment',dp:2,revision:project.revision},{id:'new-training',title:'Train Dance',type:'training',description:'Practice',dp:1,revision:null,trainingSkill:{itemId:row.id,name:row.name,start:api.baseline(row),fullBefore:row.effective}}];
    await api.saveReadableDistribution(actor,game.user,'gm',draft,saved.fingerprint);
    await api.publishDowntimeActivity(actor,'project1',{status:'open',completeOnApply:true,secret:'PRIVATE spirit'},read().fingerprint);
    await api.applyProgression(actor);
    const dossier=api.dmDossiers.get(actor.uuid),privateTasks=api.privateDowntime(actor).activities,publicTasks=read().draft.downtime.activities,reference=dossier.data.characterBackups.find(b=>b.id===dossier.data.characterReference);
    const pages=Object.fromEntries(dossier.document.pages.filter(p=>p.name.startsWith('Downtime — ')).map(p=>[p.name,p.text.content]));
    return {privateTasks,publicTasks,old,referenceTasks:reference.privateData.downtime.activities,referenceNotes:reference.actor.system.background.biography,notes:actor.system.background.biography,requests:read().draft.downtime.requests.length,pages};
  });
  assert.equal(result.privateTasks.length,4);assert.equal(result.publicTasks.length,4);assert.equal(result.requests,0);
  assert.deepEqual(result.privateTasks.filter(a=>['finished','failed'].includes(a.id)),result.old);assert.deepEqual(result.referenceTasks,result.privateTasks);assert.equal(result.referenceNotes,result.notes);
  assert.equal(result.privateTasks.find(a=>a.id==='project1').invested,4);assert.equal(result.publicTasks.find(a=>a.id==='project1').status,'complete');assert.equal(result.publicTasks.find(a=>a.id==='new-training').convertedDP,1);
  assert.match(result.pages['Downtime — Active'],/Train Dance/);assert.match(result.pages['Downtime — Completed'],/Find a spirit/);assert.match(result.pages['Downtime — Failed'],/PRIVATE failed/);assert.doesNotMatch(result.notes,/PRIVATE/);
},true));

test('XP-only application keeps and verifies the full downtime collection and refreshes its compendium reference',async()=>fixture(async page=>{
  await setupDowntime(page);
  const result=await page.evaluate(async()=>{
    await api.applyProgression(actor);const before=structuredClone(api.privateDowntime(actor).activities),snapshot=api.readPlayerActor(actor,game.user,'gm'),saved=api.readReadableDistribution(actor.system.background.biography,snapshot),row=snapshot.rows.find(r=>r.id==='scan');
    saved.draft.amounts={xp:1,tp:0,dp:0};saved.draft.entries=[{itemId:row.id,name:row.name,type:'skill',xp:1,tp:0,direction:'add',start:api.baseline(row)}];
    await api.saveReadableDistribution(actor,game.user,'gm',saved.draft,saved.fingerprint);const tx=await api.applyProgression(actor),data=api.dmDossiers.get(actor.uuid).data,ref=data.characterBackups.find(b=>b.id===data.characterReference);
    return {before,after:api.privateDowntime(actor).activities,plan:tx.plan.downtimeChanges,reference:ref.privateData.downtime.activities,history:ref.privateData.progression.history.at(-1).id,id:tx.id};
  });assert.deepEqual(result.after,result.before);assert.deepEqual(result.reference,result.after);assert.deepEqual(result.plan.after,result.after);assert.deepEqual(result.plan.changes,[]);assert.equal(result.history,result.id);
},true));

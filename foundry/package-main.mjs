const moduleId='companion-manager';
const engineVersion='0.17.3';
const packageVersion='0.17.3';
function supported() {
  return String(game.version)==='14.367'&&game.system?.id==='rqg'&&game.system.version==='6.1.1';
}
async function open(role) {
  if(!supported())return ui.notifications.error('RQ compagnon Manager requires Foundry 14.367 and RuneQuest Glorantha 6.1.1.');
  if(role==='dm'&&!game.user.isGM)return ui.notifications.error('The DM Manager is reserved for the GM.');
  const app=await import(`./${role}.mjs`);
  return app.launch();
}
export async function installLaunchers() {
  if(!game.user.isGM||!supported())return false;
  // Only one connected GM creates launchers. Existing standalone macros are preserved.
  const firstGM=Array.from(game.users).filter(user=>user.active&&user.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(firstGM&&firstGM.id!==game.user.id)return false;
  for(const role of ['dm','pc']) {
    const existing=Array.from(game.macros).find(macro=>macro.flags?.[moduleId]?.launcher===role);
    const data={name:`RQ compagnon Manager ${role.toUpperCase()} (Module)`,type:'script',scope:'global',img:`modules/${moduleId}/icons/compagnon-${role}.svg`,
      command:`const manager = game.modules.get("${moduleId}");\nif (!manager?.active || !manager.api) return ui.notifications.warn("Enable the RQ compagnon Manager module first.");\nreturn manager.api.open${role.toUpperCase()}();`,
      flags:{[moduleId]:{launcher:role,version:engineVersion,packageVersion}},ownership:{default:role==='pc'?2:0,[game.user.id]:3}};
    if(!existing)await Macro.create(data);
    else if(existing.flags[moduleId].version!==engineVersion||existing.flags[moduleId].packageVersion!==packageVersion)await existing.update({name:data.name,command:data.command,img:data.img,[`flags.${moduleId}.version`]:engineVersion,[`flags.${moduleId}.packageVersion`]:packageVersion});
  }
  return true;
}
Hooks.once('ready',async()=>{
  const module=game.modules.get(moduleId);
  module.api={version:packageVersion,engineVersion,openDM:()=>open('dm'),openPC:()=>open('pc'),installLaunchers};
  if(!supported())return ui.notifications.warn('RQ compagnon Manager is inactive: requires Foundry 14.367 and RuneQuest Glorantha 6.1.1.');
  try {await installLaunchers();}
  catch(error){ui.notifications.error('RQ compagnon Manager could not create launchers: '+error.message);console.error(moduleId,error);}
});

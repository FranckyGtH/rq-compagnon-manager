// The PC macro contains no compendium access. Only a GM session populates this cache.
export const dmDossiers=new Map();
export function managerState(actor,user=game.user) {
  if(!user?.isGM)return {schema:1,active:null,history:[],statTicks:{}};
  if(actor.flags?.world?.companionManager?.schema===2) {
    const cached=dmDossiers.get(actor.uuid);
    if(!cached)return {schema:1,active:null,history:[],statTicks:{}};
    return cached.data.progression;
  }
  return actor.flags?.world?.companionManager??{schema:1,active:null,history:[]};
}

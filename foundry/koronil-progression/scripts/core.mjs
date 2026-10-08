export const MODULE_ID = "koronil-progression";
export const LABELS = Object.freeze({
  agility: "Agilité", communication: "Communication", knowledge: "Connaissance",
  magic: "Magie", manipulation: "Manipulation", perception: "Perception", stealth: "Discrétion",
  meleeWeapons: "Armes de mêlée", missileWeapons: "Armes à distance", shields: "Boucliers",
  naturalWeapons: "Armes naturelles", otherSkills: "Autres compétences",
  element: "Élément", power: "Pouvoir", form: "Forme", condition: "Condition", technique: "Technique"
});

export function checkEnvironment(game) {
  if (String(game.version) !== "14.367") throw new Error("Cette version de test cible Foundry 14.367.");
  if (game.system?.id !== "rqg" || game.system?.version !== "6.1.1") {
    throw new Error("Cette version de test cible RuneQuest Glorantha 6.1.1.");
  }
}

export function canReadActor(actor, user, role) {
  if (!user || !actor || actor.type !== "character") return false;
  if (role === "gm") return user.isGM === true;
  if (role !== "player") return false;
  return user.isGM === true || actor.testUserPermission?.(user, "OBSERVER") === true;
}

export function listActors(actors, user, role) {
  if (role === "gm" && !user?.isGM) throw new Error("L’interface MJ est réservée au maître de jeu.");
  if (!["player", "gm"].includes(role)) throw new Error("Interface inconnue.");
  return Array.from(actors ?? []).filter(actor => canReadActor(actor, user, role))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
}

function integer(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

// Reads persisted and prepared data without calling any document mutation or sheet method.
export function readActor(actor, user, role) {
  if (!canReadActor(actor, user, role)) throw new Error("Ce personnage n’est pas accessible avec cette interface.");
  const rows = [];
  const warnings = [];
  for (const item of actor.items ?? []) {
    if (!["skill", "passion", "rune"].includes(item.type)) continue;
    const system = item.system ?? {};
    const base = item.type === "skill" ? integer(system.baseChance) : null;
    const gained = item.type === "skill" ? integer(system.gainedChance) : null;
    const raw = item.type === "skill" ? (base === null || gained === null ? null : base + gained) : integer(system.chance);
    const effective = integer(system.chance);
    const categoryBonus = item.type === "skill" ? integer(system.categoryMod) : null;
    const category = item.type === "skill" ? system.category : item.type === "rune" ? system.runeType?.type : "passion";
    if (raw === null) warnings.push(`Valeur persistée indisponible : ${item.name}.`);
    rows.push({
      id: item.id ?? item._id, name: String(item.name ?? "Sans nom"), type: item.type,
      category: String(category ?? ""), categoryLabel: LABELS[category] ?? String(category ?? "—"),
      base, gained, raw, effective, categoryBonus,
      tick: system.hasExperience === true, canGetExperience: system.canGetExperience === true
    });
  }
  rows.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel, "fr") || a.name.localeCompare(b.name, "fr"));
  return {
    id: actor.id ?? actor._id, uuid: actor.uuid ?? null, name: String(actor.name),
    editMode: actor.system?.editMode === true,
    isOwner: user.isGM === true || actor.testUserPermission?.(user, "OWNER") === true,
    counts: Object.fromEntries(["skill", "passion", "rune"].map(type => [type, rows.filter(r => r.type === type).length])),
    ticks: rows.filter(row => row.tick).length,
    rows, warnings
  };
}

export function filterRows(rows, { type = "skill", category = "", search = "", ticksOnly = false, sort = "category" } = {}) {
  const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  const query = normalize(search.trim());
  const filtered = rows.filter(row => row.type === type && (!category || row.category === category)
    && (!ticksOnly || row.tick) && (!query || normalize(`${row.name} ${row.categoryLabel}`).includes(query)));
  const byName=(a,b)=>a.categoryLabel.localeCompare(b.categoryLabel,"en")||a.name.localeCompare(b.name,"en");
  return filtered.sort((a,b)=>{
    if(!['full-asc','full-desc'].includes(sort))return byName(a,b);
    const av=Number.isFinite(a.effective),bv=Number.isFinite(b.effective);
    if(av!==bv)return av?-1:1;
    return (av?(a.effective-b.effective)*(sort==='full-desc'?-1:1):0)||byName(a,b);
  });
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

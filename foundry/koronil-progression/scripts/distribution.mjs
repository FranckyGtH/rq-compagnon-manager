import { canReadActor, readActor, escapeHTML } from './core.mjs';

const kinds = ['POINTS', 'WISHES'];
const titles = { POINTS: 'Points à distribuer', WISHES: 'Souhaits de progression' };
export const marker = (kind, edge) => `[KORONIL-PROGRESSION:${kind}:${edge}]`;
const quantity = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, expected) {
  if (!object(value) || Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) throw new Error('Structure des notes non reconnue. Aucune note ne sera écrasée.');
}
function text(value) { return typeof value === 'string' && value.length > 0 && value.length <= 300; }
export function parseQuantity(value) {
  if (!/^\d+$/.test(String(value)) || !quantity(Number(value))) throw new Error('Les points doivent être des entiers de 0 à 1 000 000.');
  return Number(value);
}
export function unitGains(row) {
  const raw = row.raw;
  if (!Number.isFinite(raw)) return { xp: null, tp: null };
  const xp = row.name.endsWith('W') ? null : raw <= 40 ? (row.tick ? 6 : 3) : raw <= 70 ? (row.tick ? 4 : 2) : raw <= 90 ? (row.tick ? 2 : 1) : row.tick ? 1 : null;
  const tp = row.type === 'skill' && raw <= 75 ? (raw <= 40 ? 3 : 2) : null;
  return { xp, tp };
}
export function baseline(row) { return { raw: row.raw, base: row.base, gained: row.gained, tick: row.tick }; }
export function validateDraft(draft, snapshot, { checkCurrent = true } = {}) {
  keys(draft.amounts, ['xp', 'tp', 'dp']);
  if (!Object.values(draft.amounts).every(quantity)) throw new Error('Budgets XP, TP et DP invalides.');
  if (!Array.isArray(draft.entries) || draft.entries.length > 1000) throw new Error('Liste des souhaits invalide.');
  const seen = new Set();
  const used = { xp: 0, tp: 0, dp: 0 };
  for (const entry of draft.entries) {
    keys(entry, ['itemId', 'type', 'name', 'xp', 'tp', 'direction', 'start']);
    keys(entry.start, ['raw', 'base', 'gained', 'tick']);
    if (!text(entry.itemId) || !text(entry.name) || !['skill', 'rune', 'passion'].includes(entry.type) || seen.has(entry.itemId)) throw new Error('Souhait absent, dupliqué ou mal formé.');
    seen.add(entry.itemId);
    if (!quantity(entry.xp) || !quantity(entry.tp) || entry.xp + entry.tp === 0 || !['add', 'subtract'].includes(entry.direction)) throw new Error('Allocation invalide.');
    if (entry.type === 'skill' && entry.direction !== 'add' || entry.type !== 'skill' && entry.tp !== 0) throw new Error('Les TP concernent seulement les compétences ; leur progression est positive.');
    if (!Number.isSafeInteger(entry.start.raw) || typeof entry.start.tick !== 'boolean' || (entry.type === 'skill' ? !Number.isSafeInteger(entry.start.base) || !Number.isSafeInteger(entry.start.gained) || entry.start.raw !== entry.start.base + entry.start.gained : entry.start.base !== null || entry.start.gained !== null)) throw new Error('État de départ invalide.');
    const row = snapshot.rows.find(r => r.id === entry.itemId);
    if (!row || row.type !== entry.type) throw new Error(`Entrée supprimée ou remplacée : ${entry.name}.`);
    if (checkCurrent && Object.entries(baseline(row)).some(([key,value]) => entry.start[key] !== value)) throw new Error(`La fiche a changé pour ${row.name}. Retire ce souhait puis ajoute-le à nouveau avec les valeurs actuelles.`);
    const gains = unitGains({ ...row, ...entry.start });
    if (entry.xp && gains.xp === null || entry.tp && gains.tp === null) throw new Error(`Allocation impossible selon le barème pour ${row.name}.`);
    used.xp += entry.xp; used.tp += entry.tp;
  }
  for (const type of ['xp', 'tp']) if (used[type] > draft.amounts[type]) throw new Error(`Budget ${type.toUpperCase()} dépassé : ${used[type]} affectés pour ${draft.amounts[type]} disponibles.`);
  return { used, remaining: Object.fromEntries(Object.keys(used).map(k => [k, draft.amounts[k] - used[k]])) };
}

// Locate marker paragraphs in the original string, preserving every unrelated byte.
export function ranges(html) {
  const found = {};
  for (const kind of kinds) {
    const edges = [];
    for (const edge of ['BEGIN', 'END']) {
      const token = marker(kind, edge);
      const occurrences = html.split(token).length - 1;
      const paragraphs = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi)].filter(match => {
        const doc = new DOMParser().parseFromString(match[0], 'text/html');
        return doc.body.textContent.trim() === token;
      });
      if (occurrences !== paragraphs.length || occurrences > 1) throw new Error('Repères des notes endommagés ou dupliqués. Aucune note ne sera écrasée.');
      edges.push(paragraphs[0] ?? null);
    }
    if (!edges[0] && !edges[1]) { found[kind] = null; continue; }
    if (!edges[0] || !edges[1] || edges[1].index <= edges[0].index) throw new Error('Section des notes incomplète. Aucune note ne sera écrasée.');
    const start = edges[0].index, end = edges[1].index + edges[1][0].length;
    found[kind] = { start, end, html: html.slice(start, end), inner: html.slice(start + edges[0][0].length, edges[1].index) };
  }
  const [a,b] = kinds.map(k => found[k]);
  if (a && b && a.start < b.end && b.start < a.end) throw new Error('Sections des notes imbriquées.');
  return found;
}
function payload(range) {
  const doc = new DOMParser().parseFromString(range.inner, 'text/html');
  const elements = [...doc.body.children];
  if (elements.length !== 2 || !/^H[1-6]$/.test(elements[0].tagName) || elements[1].tagName !== 'PRE' || elements[1].querySelector('script,img,iframe') || doc.body.textContent.length > 200000) throw new Error('Contenu des sections réservé mal formé.');
  try { return JSON.parse(elements[1].textContent); }
  catch { throw new Error('Données des notes illisibles. Aucune note ne sera écrasée.'); }
}
export function readDistribution(html, snapshot) {
  if (typeof html !== 'string') throw new Error('Le champ des notes est indisponible.');
  const sections = ranges(html);
  const fingerprint = JSON.stringify(kinds.map(k => sections[k]?.html ?? null));
  const empty = { amounts: { xp: 0, tp: 0, dp: 0 }, entries: [] };
  if (kinds.every(k => !sections[k])) return { draft: empty, fingerprint, present: false };
  if (kinds.some(k => !sections[k])) throw new Error('Les sections Points et Souhaits doivent être présentes ensemble.');
  const points = payload(sections.POINTS), wishes = payload(sections.WISHES);
  keys(points, ['version', 'actorUuid', 'revision', 'updatedBy', 'updatedAt', 'origin', 'amounts']);
  keys(wishes, ['version', 'actorUuid', 'revision', 'entries']);
  if (points.version !== 1 || wishes.version !== 1 || points.actorUuid !== snapshot.uuid || wishes.actorUuid !== snapshot.uuid || !text(points.revision) || points.revision !== wishes.revision || !text(points.updatedBy) || !text(points.updatedAt) || !Number.isFinite(Date.parse(points.updatedAt)) || !['player-declared', 'gm-declared'].includes(points.origin)) throw new Error('Version, personnage ou révision des notes incohérents.');
  const draft = { amounts: points.amounts, entries: wishes.entries };
  // Existing wishes can be stale: keep them visible, never silently erase them.
  validateDraft(draft, snapshot, { checkCurrent: false });
  return { draft, fingerprint, present: true, revision: points.revision, updatedAt: points.updatedAt };
}
function section(kind, data) {
  return `<p>${marker(kind, 'BEGIN')}</p><h3>${titles[kind]}</h3><pre>${escapeHTML(JSON.stringify(data, null, 2))}</pre><p>${marker(kind, 'END')}</p>`;
}
export function writeDistribution(html, draft, snapshot, user, expectedFingerprint, revision) {
  const current = readDistribution(html, snapshot);
  if (current.fingerprint !== expectedFingerprint) throw new Error('Les souhaits ou les points ont été modifiés ailleurs. Recharge les notes avant de continuer ; ton brouillon reste affiché.');
  validateDraft(draft, snapshot);
  const common = { version: 1, actorUuid: snapshot.uuid, revision };
  const replacements = {
    POINTS: section('POINTS', { ...common, updatedBy: user.id, updatedAt: new Date().toISOString(), origin: user.isGM ? 'gm-declared' : 'player-declared', amounts: draft.amounts }),
    WISHES: section('WISHES', { ...common, entries: draft.entries })
  };
  const positions = ranges(html);
  if (!current.present) return html + '\n' + kinds.map(k => replacements[k]).join('\n');
  let result = html;
  for (const kind of [...kinds].sort((a,b) => positions[b].start - positions[a].start)) result = result.slice(0, positions[kind].start) + replacements[kind] + result.slice(positions[kind].end);
  return result;
}
export function canSaveNotes(actor, user, role) {
  return canReadActor(actor, user, role) && actor.canUserModify?.(user, 'update') === true;
}
export function checkNativeNotesSideEffects(actor) {
  // RQG 6.1.1 _preUpdate reconciles Dodge/Jump on EVERY Actor update,
  // including biography. Refuse that implicit skill write in this stage.
  const dex = actor.system?.characteristics?.dexterity?.value;
  if (dex == null) return;
  if (!Number.isFinite(dex) || typeof actor.getBestEmbeddedDocumentByRqid !== 'function') throw new Error('Impossible de vérifier les effets de la sauvegarde des notes sur cette fiche.');
  for (const [rqid, multiplier] of [['i.skill.dodge', 2], ['i.skill.jump', 3]]) {
    const item = actor.getBestEmbeddedDocumentByRqid(rqid);
    if (item && item._source?.system?.baseChance !== dex * multiplier) throw new Error(`Le système voudrait recalculer automatiquement la base de ${item.name} à la sauvegarde des notes. Enregistrement bloqué pour préserver les compétences ; le MJ doit vérifier la fiche native.`);
  }
}
export async function saveDistribution(actor, user, role, draft, expectedFingerprint) {
  if (!canSaveNotes(actor, user, role)) throw new Error('Ce compte ne peut pas enregistrer les notes de ce personnage. Le brouillon reste non enregistré ; le relais MJ sera ajouté ultérieurement.');
  checkNativeNotesSideEffects(actor);
  const snapshot = readActor(actor, user, role);
  const html = actor.system?.background?.biography;
  // Foundry is often served over HTTP on a LAN, where randomUUID is unavailable.
  const revision = globalThis.crypto?.randomUUID?.() ?? globalThis.foundry.utils.randomID(32);
  const next = writeDistribution(html, draft, snapshot, user, expectedFingerprint, revision);
  // Only this one Actor field is ever submitted. No Items, flags or editMode updates.
  const result = await actor.update({ 'system.background.biography': next });
  if (!result) throw new Error('Enregistrement refusé. Le brouillon reste non enregistré.');
  const saved = readDistribution(actor.system.background.biography, readActor(actor, user, role));
  if (saved.revision !== revision || JSON.stringify(saved.draft) !== JSON.stringify(draft)) throw new Error('La sauvegarde n’a pas pu être vérifiée. Recharge les notes pour vérifier leur état.');
  return saved;
}

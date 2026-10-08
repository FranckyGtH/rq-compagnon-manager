import { MODULE_ID, canReadActor, listActors, readActor, filterRows, escapeHTML as esc } from "./core.mjs";

const percentage = value => value === null ? "—" : `${value} %`;
const signed = value => value === null ? "—" : `${value > 0 ? "+" : ""}${value}`;

export class ProgressionApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID], tag: "div",
    window: { icon: "fa-solid fa-leaf", resizable: true },
    position: { width: 900, height: 690 }
  };

  constructor({ role, actorId = null }) {
    super({ id: `${MODULE_ID}-${role}` });
    this.role = role;
    this.actorId = actorId;
    this.filters = { type: "skill", category: "", search: "", ticksOnly: false };
  }

  get title() { return `Progression de Koronil · ${this.role === "gm" ? "MJ" : "Joueur"} · Étape 1`; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actors = listActors(game.actors, game.user, this.role);
    if (!actors.some(actor => actor.id === this.actorId)) this.actorId = actors[0]?.id ?? null;
    const actor = this.actorId ? game.actors.get(this.actorId) : null;
    const snapshot = actor ? readActor(actor, game.user, this.role) : null;
    return { ...context, actors, snapshot };
  }

  async _renderHTML({ actors, snapshot }) {
    const root = document.createElement("div");
    root.className = "kp-content";
    root.innerHTML = `
      <div class="kp-intro"><div><strong>Progression du personnage</strong><p>Étape 1 · Consultation des données de la fiche</p></div><span class="kp-badge">Lecture seule</span></div>
      <div class="kp-selection"><label>Personnage<select data-kp="actor" ${actors.length ? "" : "disabled"}>
        ${actors.map(actor => `<option value="${esc(actor.id)}" ${actor.id === this.actorId ? "selected" : ""}>${esc(actor.name)}</option>`).join("") || '<option>Aucun personnage accessible</option>'}
      </select></label><button type="button" data-kp="refresh"><i class="fas fa-rotate" aria-hidden="true"></i> Actualiser</button></div>
      ${snapshot ? `
        <div class="kp-character"><h2>${esc(snapshot.name)}</h2><p>${snapshot.isOwner ? "Accès propriétaire" : "Accès en consultation"} · Fiche en mode ${snapshot.editMode ? "modification" : "jeu"}</p></div>
        <div class="kp-tabs" role="group" aria-label="Type de données">
          ${[["skill", "Compétences"], ["passion", "Passions"], ["rune", "Runes"]].map(([type,label]) => `<button type="button" data-type="${type}" aria-pressed="${type === this.filters.type}">${label}<span>${snapshot.counts[type]}</span></button>`).join("")}
        </div>
        <div class="kp-filters"><label>Rechercher<input type="search" data-kp="search" placeholder="Nom ou catégorie" value="${esc(this.filters.search)}"></label>
          <label>Catégorie<select data-kp="category"></select></label>
          <label class="kp-checkbox"><input type="checkbox" data-kp="ticks" ${this.filters.ticksOnly ? "checked" : ""}> Avec coche d’expérience</label></div>
        <p class="kp-result" data-kp="result" aria-live="polite"></p>
        <div class="kp-table-wrap"><table><thead data-kp="head"></thead><tbody data-kp="rows"></tbody></table></div>
        <p class="kp-help">Brut : base + acquis pour les compétences. Effectif : valeur calculée par RuneQuest, avec ses bonus et malus. Une valeur indisponible est affichée « — ».</p>
        ${snapshot.warnings.length ? `<div class="kp-warning">${snapshot.warnings.map(esc).join("<br>")}</div>` : ""}
      ` : '<div class="kp-empty">Aucun personnage de type aventurier n’est accessible à ce compte. Vérifie les permissions du personnage dans Foundry.</div>'}
      <footer>Aucune allocation ni sauvegarde sur la fiche à cette étape. Version 0.1.0.</footer>`;
    root.querySelector('[data-kp="actor"]').addEventListener("change", event => {
      this.actorId = event.target.value;
      this.filters.category = "";
      void this.refresh();
    });
    root.querySelector('[data-kp="refresh"]').addEventListener("click", () => void this.refresh());
    if (snapshot) this.attachFilters(root, snapshot);
    return root;
  }

  _replaceHTML(root, content) { content.replaceChildren(root); }

  async refresh() {
    try { await this.render({ force: true }); }
    catch (error) { ui.notifications.error(error.message); }
  }

  attachFilters(root, snapshot) {
    const categorySelect = root.querySelector('[data-kp="category"]');
    const fillCategories = () => {
      const categories = new Map(snapshot.rows.filter(r => r.type === this.filters.type).map(r => [r.category, r.categoryLabel]));
      categorySelect.innerHTML = '<option value="">Toutes les catégories</option>' + [...categories].sort((a,b) => a[1].localeCompare(b[1], "fr"))
        .map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("");
      categorySelect.value = this.filters.category;
    };
    const updateRows = () => {
      const actor = game.actors.get(this.actorId);
      if (!canReadActor(actor, game.user, this.role)) {
        root.querySelector('[data-kp="rows"]').replaceChildren();
        root.querySelector('[data-kp="result"]').textContent = "Accès retiré. Actualise la liste des personnages.";
        return;
      }
      const isSkill = this.filters.type === "skill";
      const rows = filterRows(snapshot.rows, this.filters);
      root.querySelector('[data-kp="head"]').innerHTML = `<tr><th>Nom</th><th>Catégorie</th>${isSkill ? "<th>Base</th><th>Acquis</th><th>Brut</th><th>Bonus</th><th>Effectif</th>" : "<th>Valeur</th>"}<th>Coche XP</th><th>XP autorisée</th></tr>`;
      root.querySelector('[data-kp="rows"]').innerHTML = rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.categoryLabel)}</td>${isSkill ? `<td>${percentage(row.base)}</td><td>${percentage(row.gained)}</td><td>${percentage(row.raw)}</td><td>${signed(row.categoryBonus)}</td><td>${percentage(row.effective)}</td>` : `<td>${percentage(row.raw)}</td>`}<td>${row.tick ? '<span class="kp-tick">Oui</span>' : "—"}</td><td>${row.canGetExperience ? "Oui" : "Non"}</td></tr>`).join("") || `<tr><td colspan="${isSkill ? 9 : 5}" class="kp-empty">Aucune entrée ne correspond aux filtres.</td></tr>`;
      root.querySelector('[data-kp="result"]').textContent = `${rows.length} entrée${rows.length > 1 ? "s" : ""} affichée${rows.length > 1 ? "s" : ""} · ${rows.filter(row => row.tick).length} avec une coche d’expérience`;
      root.querySelectorAll("[data-type]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.type === this.filters.type)));
    };
    root.querySelectorAll("[data-type]").forEach(button => button.addEventListener("click", () => {
      this.filters.type = button.dataset.type;
      this.filters.category = "";
      fillCategories(); updateRows();
    }));
    root.querySelector('[data-kp="search"]').addEventListener("input", event => { this.filters.search = event.target.value; updateRows(); });
    categorySelect.addEventListener("change", event => { this.filters.category = event.target.value; updateRows(); });
    root.querySelector('[data-kp="ticks"]').addEventListener("change", event => { this.filters.ticksOnly = event.target.checked; updateRows(); });
    fillCategories(); updateRows();
  }
}

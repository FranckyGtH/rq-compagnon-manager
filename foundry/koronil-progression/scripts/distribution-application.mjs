import { ProgressionApplication } from './application.mjs';
import { readActor, escapeHTML as esc } from './core.mjs';
import { readDistribution, validateDraft, baseline, unitGains, parseQuantity, canSaveNotes, saveDistribution } from './distribution.mjs';

export class DistributionApplication extends ProgressionApplication {
  constructor(options) {
    super(options);
    this.states = new Map();
    this.pane = 'wishes';
  }
  get title() { return `Progression de Koronil · ${this.role === 'gm' ? 'MJ' : 'Joueur'} · Étape 2`; }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (context.snapshot) {
      const prior = this.states.get(this.actorId);
      if (!prior || !prior.dirty) this.loadState(context.snapshot);
    }
    return context;
  }
  loadState(snapshot) {
    const actor = game.actors.get(snapshot.id);
    try {
      const saved = readDistribution(actor.system?.background?.biography, snapshot);
      this.states.set(snapshot.id, { ...saved, dirty: false, error: null });
    } catch (error) {
      this.states.set(snapshot.id, { error: error.message, dirty: false });
    }
  }
  async _renderHTML(context) {
    const root = await super._renderHTML(context);
    root.querySelector('.kp-intro p').textContent = 'Étape 2 · Points et souhaits de progression';
    root.querySelector('.kp-badge').textContent = 'Souhaits sans appliquer';
    root.querySelector('footer').textContent = 'Version 0.2.0 · Seules les sections dédiées des notes sont enregistrées. Les compétences, runes, passions et coches restent inchangées.';
    if (!context.snapshot) return root;
    const consultation = document.createElement('div');
    consultation.className = 'kp-consultation';
    [...root.children].filter(child => !child.matches('.kp-intro,.kp-selection,footer')).forEach(child => consultation.append(child));
    const nav = document.createElement('div'); nav.className = 'kp-tabs';
    nav.innerHTML = '<button type="button" data-pane="wishes">Points et souhaits</button><button type="button" data-pane="read">Consulter la fiche</button>';
    const wishes = this.buildWishes(context.snapshot);
    const footer = root.querySelector('footer');
    root.insertBefore(nav, footer); root.insertBefore(consultation, footer); root.insertBefore(wishes, footer);
    const show = () => {
      consultation.hidden = this.pane !== 'read'; wishes.hidden = this.pane !== 'wishes';
      nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === this.pane)));
    };
    nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { this.pane = button.dataset.pane; show(); }));
    show();
    return root;
  }
  buildWishes(snapshot) {
    const actor = game.actors.get(snapshot.id), state = this.states.get(snapshot.id);
    const panel = document.createElement('div'); panel.className = 'kp-wishes';
    if (state.error) {
      panel.innerHTML = `<div class="kp-warning">${esc(state.error)}<p>Enregistrement bloqué pour préserver les notes existantes.</p></div><button type="button" data-reload>Recharger les notes</button>`;
      panel.querySelector('[data-reload]').addEventListener('click', () => { this.loadState(snapshot); void this.refresh(); });
      return panel;
    }
    const canSave = canSaveNotes(actor, game.user, this.role);
    panel.innerHTML = `
      <div class="kp-budgets">${['xp','tp','dp'].map(type => `<label>${type.toUpperCase()} à distribuer<input type="number" min="0" max="1000000" step="1" data-budget="${type}" value="${state.draft.amounts[type] ?? ''}"></label>`).join('')}</div>
      <p>Montants déclarés, à vérifier par le MJ. Les DP sont conservés pour la prochaine étape de gestion des activités.</p>
      <p class="kp-summary" data-summary aria-live="polite"></p>
      <div class="kp-warning" data-errors hidden></div>
      <div class="kp-add"><label>Rechercher une entrée<input type="search" data-find placeholder="Nom de compétence, passion ou rune"></label><label>Entrée<select data-item></select></label>
        <label>XP<input type="number" min="0" max="1000000" step="1" data-add-xp value="0"></label><label>TP<input type="number" min="0" max="1000000" step="1" data-add-tp value="0"></label>
        <label>Sens<select data-add-direction><option value="add">Augmenter</option><option value="subtract">Diminuer</option></select></label><button type="button" data-add>Ajouter / remplacer</button></div>
      <p data-choice></p>
      <div class="kp-table-wrap"><table><thead><tr><th>Entrée</th><th>Départ</th><th>XP</th><th>TP</th><th>Sens</th><th></th></tr></thead><tbody data-entries></tbody></table></div>
      <p data-state aria-live="polite"></p>
      ${!canSave ? '<div class="kp-warning">Ce compte peut consulter la fiche mais ne peut pas écrire ses notes. Le brouillon reste dans cette fenêtre ; il n’est pas transmis au MJ.</div>' : ''}
      <div class="kp-actions"><button type="button" data-save ${canSave ? '' : 'disabled'}>Enregistrer les souhaits dans les notes</button><button type="button" data-reload>Recharger les notes (abandonner le brouillon)</button></div>`;
    const itemSelect = panel.querySelector('[data-item]');
    const saveButton = panel.querySelector('[data-save]');
    const markDirty = () => { state.dirty = true; updateSummary(); };
    const updateSummary = () => {
      const used = { xp: state.draft.entries.reduce((s,e) => s+e.xp,0), tp: state.draft.entries.reduce((s,e) => s+e.tp,0), dp: 0 };
      panel.querySelector('[data-summary]').textContent = ['xp','tp','dp'].map(k => `${k.toUpperCase()} : ${used[k]} affectés · ${state.draft.amounts[k] === null ? '—' : state.draft.amounts[k] - used[k]} restants`).join(' | ');
      const errors = panel.querySelector('[data-errors]');
      let valid = true;
      try {
        panel.querySelectorAll('[data-budget]').forEach(input => parseQuantity(input.value));
        panel.querySelectorAll('[data-quantity]').forEach(input => parseQuantity(input.value));
        validateDraft(state.draft, readActor(actor, game.user, this.role));
        errors.hidden = true; errors.textContent = '';
      } catch (error) { valid = false; errors.hidden = false; errors.textContent = error.message; }
      saveButton.disabled = !canSave || !valid;
      panel.querySelector('[data-state]').textContent = state.dirty ? 'Brouillon non enregistré sur la fiche. Il reste disponible dans cette application tant que cet onglet du navigateur reste ouvert.' : state.present ? 'Souhaits chargés depuis les notes du personnage.' : 'Aucune distribution enregistrée. La première sauvegarde créera les deux sections dédiées.';
    };
    const renderEntries = () => {
      panel.querySelector('[data-entries]').innerHTML = state.draft.entries.map(entry => `<tr data-entry="${esc(entry.itemId)}"><td>${esc(entry.name)}<br><small>${entry.type === 'skill' ? 'Compétence' : entry.type === 'rune' ? 'Rune' : 'Passion'}</small></td><td>${entry.start.raw} %${entry.start.tick ? ' · ✓' : ''}</td><td><input aria-label="XP ${esc(entry.name)}" type="number" min="0" max="1000000" step="1" data-quantity="xp" value="${entry.xp ?? ''}"></td><td>${entry.type === 'skill' ? `<input aria-label="TP ${esc(entry.name)}" type="number" min="0" max="1000000" step="1" data-quantity="tp" value="${entry.tp ?? ''}">` : '—'}</td><td>${entry.type === 'skill' ? 'Augmenter' : `<select aria-label="Sens ${esc(entry.name)}" data-direction><option value="add" ${entry.direction === 'add' ? 'selected' : ''}>Augmenter</option><option value="subtract" ${entry.direction === 'subtract' ? 'selected' : ''}>Diminuer</option></select>`}</td><td><button type="button" data-remove>Retirer</button></td></tr>`).join('') || '<tr><td colspan="6" class="kp-empty">Aucun souhait préparé.</td></tr>';
      panel.querySelectorAll('[data-entry]').forEach(tr => {
        const entry = state.draft.entries.find(e => e.itemId === tr.dataset.entry);
        tr.querySelectorAll('[data-quantity]').forEach(input => input.addEventListener('input', () => {
          state.dirty = true;
          try { entry[input.dataset.quantity] = parseQuantity(input.value); } catch { entry[input.dataset.quantity] = null; }
          updateSummary();
        }));
        tr.querySelector('[data-direction]')?.addEventListener('change', event => { entry.direction = event.target.value; markDirty(); });
        tr.querySelector('[data-remove]').addEventListener('click', () => { state.draft.entries = state.draft.entries.filter(e => e.itemId !== entry.itemId); state.dirty = true; renderEntries(); });
      });
      updateSummary();
    };
    const updateChoice = () => {
      const row = snapshot.rows.find(r => r.id === itemSelect.value);
      const tp = panel.querySelector('[data-add-tp]'), direction = panel.querySelector('[data-add-direction]');
      tp.disabled = row?.type !== 'skill'; direction.disabled = row?.type === 'skill' || !row;
      if (tp.disabled) tp.value = '0';
      if (direction.disabled) direction.value = 'add';
      if (!row) { panel.querySelector('[data-choice]').textContent = 'Aucune entrée correspondante.'; return; }
      const gains = unitGains(row);
      panel.querySelector('[data-choice]').textContent = `${row.name} · brut ${row.raw ?? '—'} % · ${row.tick ? 'avec' : 'sans'} coche · XP ${gains.xp === null ? 'impossible' : 'possible'} · TP ${gains.tp === null ? 'impossible' : 'possible'}. L’aperçu des gains sera ajouté à l’étape 3.`;
    };
    const fillChoices = () => {
      const selected = itemSelect.value;
      const query = panel.querySelector('[data-find]').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      itemSelect.innerHTML = snapshot.rows.filter(row => row.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query)).map(row => `<option value="${esc(row.id)}">${esc(row.name)} (${row.type === 'skill' ? 'Compétence' : row.type === 'rune' ? 'Rune' : 'Passion'})</option>`).join('');
      if ([...itemSelect.options].some(option => option.value === selected)) itemSelect.value = selected;
      updateChoice();
    };
    panel.querySelector('[data-find]').addEventListener('input', fillChoices);
    itemSelect.addEventListener('change', updateChoice);
    panel.querySelectorAll('[data-budget]').forEach(input => input.addEventListener('input', () => {
      state.dirty = true;
      try { state.draft.amounts[input.dataset.budget] = parseQuantity(input.value); } catch { state.draft.amounts[input.dataset.budget] = null; }
      updateSummary();
    }));
    panel.querySelector('[data-add]').addEventListener('click', () => {
      try {
        const row = readActor(actor, game.user, this.role).rows.find(r => r.id === itemSelect.value);
        if (!row) throw new Error('Sélectionne une entrée accessible.');
        const entry = { itemId: row.id, type: row.type, name: row.name, xp: parseQuantity(panel.querySelector('[data-add-xp]').value), tp: row.type === 'skill' ? parseQuantity(panel.querySelector('[data-add-tp]').value) : 0, direction: row.type === 'skill' ? 'add' : panel.querySelector('[data-add-direction]').value, start: baseline(row) };
        const candidate = { amounts: { ...state.draft.amounts }, entries: [...state.draft.entries.filter(e => e.itemId !== entry.itemId), entry] };
        validateDraft(candidate, readActor(actor, game.user, this.role));
        state.draft = candidate; state.dirty = true; renderEntries();
      } catch (error) { ui.notifications.warn(error.message); }
    });
    panel.querySelector('[data-reload]').addEventListener('click', () => { this.loadState(readActor(actor, game.user, this.role)); void this.refresh(); });
    saveButton.addEventListener('click', async () => {
      const controls = [...this.element.querySelectorAll('input,select,button')];
      const priorDisabled = controls.map(control => control.disabled);
      try {
        // Recheck visible inputs as well as the structured state at the last moment.
        panel.querySelectorAll('[data-budget],[data-quantity]').forEach(input => parseQuantity(input.value));
        controls.forEach(control => { control.disabled = true; });
        const draft = JSON.parse(JSON.stringify(state.draft));
        const saved = await saveDistribution(actor, game.user, this.role, draft, state.fingerprint);
        this.states.set(actor.id, { ...saved, dirty: false, error: null });
        ui.notifications.info('Points et souhaits enregistrés dans les notes. Aucune valeur de progression n’a été appliquée.');
        await this.refresh();
      } catch (error) {
        ui.notifications.error(error.message);
        controls.forEach((control,index) => { control.disabled = priorDisabled[index]; });
      }
    });
    fillChoices(); renderEntries();
    return panel;
  }
}

// Drawer admin — réglages LLM, provider, templates.
// v2 : focus trap, aria-checked, confirmation reset, aperçu du system prompt.
import { $, esc, state, toast } from './dom.js';
import {
  loadCfg, saveCfg, loadTpls, renderTplEditor, resetTpls, addTpl,
  getTpls, effectiveSystemPrompt,
} from './settings.js';
import { fetchModels } from './api.js';
import { nanoStatus } from './llm-nano.js';

let setAdminFn = null;

/** Ouvre le drawer depuis n'importe quel module (ex: endpoint manquant). */
export function openAdmin() { setAdminFn && setAdminFn(true); }

export function initAdmin() {
  const admin = $('admin'), scrim = $('scrim');
  const aProv = $('a-provider'), aEp = $('a-endpoint'), aKey = $('a-key'),
        aModel = $('a-model'), aSt = $('a-status'), aGauge = $('a-gauge'),
        gaugeFill = aGauge.querySelector('i'), modelsDl = $('models'),
        tplsDiv = $('tpls'), sysPre = $('a-syspre');
  let lastFocus = null;

  const setAdmin = (open) => {
    admin.classList.toggle('open', open);
    scrim.classList.toggle('on', open);
    if (open) {
      lastFocus = document.activeElement;
      if (aProv.value === 'nano') syncProviderUI();
      refreshSysPreview();
      // focus sur le premier champ utile
      const target = aProv.value === 'nano' ? document.querySelector('.pvcard.sel') : aEp;
      setTimeout(() => target && target.focus(), 250);
    } else if (lastFocus) {
      lastFocus.focus();
    }
  };
  setAdminFn = setAdmin;

  $('gear').onclick = () => setAdmin(!admin.classList.contains('open'));
  $('a-close').onclick = () => setAdmin(false);
  scrim.onclick = () => setAdmin(false);

  // focus trap + Escape
  admin.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setAdmin(false); return; }
    if (e.key !== 'Tab') return;
    const focusables = admin.querySelectorAll(
      'button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function syncProviderUI() {
    const nano = aProv.value === 'nano';
    document.querySelectorAll('.pvcard').forEach((c) => {
      const sel = c.dataset.pv === aProv.value;
      c.classList.toggle('sel', sel);
      c.setAttribute('aria-checked', sel ? 'true' : 'false');
    });
    [aEp, aKey, aModel, $('a-models')].forEach((el) => {
      el.disabled = nano;
      el.style.opacity = nano ? 0.4 : 1;
    });
    if (nano) nanoStatus().then((s) => {
      aSt.innerHTML = (s.ok ? '✅ ' : '⚠️ ') + esc(s.msg);
      aGauge.style.display = (s.st === 'downloading') ? 'block' : 'none';
    });
  }

  // Aperçu du system prompt effectif du template sélectionné (le premier par défaut)
  function refreshSysPreview() {
    const t = getTpls()[0];
    if (t && sysPre) sysPre.textContent = effectiveSystemPrompt(t);
  }
  $('a-syspreview').addEventListener('toggle', refreshSysPreview);
  tplsDiv.addEventListener('input', () => {
    clearTimeout(tplsDiv._pt);
    tplsDiv._pt = setTimeout(refreshSysPreview, 400);
  });

  // init depuis localStorage
  const c = loadCfg();
  aProv.value = c.provider || 'server';
  aEp.value = c.endpoint;
  aKey.value = c.apiKey;
  aModel.value = c.model;
  [aEp, aKey, aModel].forEach((el) => el.addEventListener('input', saveCfg));
  document.querySelectorAll('.pvcard').forEach((card) => {
    const pick = () => { aProv.value = card.dataset.pv; saveCfg(); syncProviderUI(); };
    card.onclick = pick;
    card.onkeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); }
    };
  });
  syncProviderUI();
  loadTpls();
  renderTplEditor(tplsDiv);

  $('a-addtpl').onclick = () => {
    addTpl();
    renderTplEditor(tplsDiv);
    // focus sur le nouveau template
    const tas = tplsDiv.querySelectorAll('textarea');
    if (tas.length) tas[tas.length - 1].focus();
  };
  $('a-reset').onclick = () => {
    // Garde-fou : double confirmation avant d'écraser les templates perso
    if (!confirm('Réinitialiser tous les templates aux valeurs par défaut ?\nVos modifications seront perdues.')) return;
    resetTpls();
    renderTplEditor(tplsDiv);
    toast('templates réinitialisés');
  };
  $('a-models').onclick = async () => {
    const ep = aEp.value.trim();
    if (!/^https?:\/\//.test(ep)) {
      aSt.textContent = '⚠ endpoint invalide — saisis une URL http(s)://… d’abord';
      aEp.focus();
      return;
    }
    aSt.textContent = '…';
    try {
      const models = await fetchModels(ep, aKey.value);
      modelsDl.innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      aSt.textContent = models.length + ' modèle(s) : ' + models.slice(0, 4).join(', ') + (models.length > 4 ? '…' : '');
    } catch (e) { aSt.textContent = 'Erreur : ' + e.message; }
  };
}

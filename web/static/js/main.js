// Point d'entrée — wiring de tous les modules.
import { $, state, Q, clearErr, toast, fail, fmt } from './dom.js';
import { orb } from './orb.js';
import { render, bindDocActions } from './transcript.js';
import { initAdmin } from './admin.js';
import { renderTplBar, initTplBar, autoRunTpl } from './llm.js';
import { fetchTracks, fetchTranscript } from './api.js';

const f = $('f'), st = $('status'), opts = $('opts'),
      orbstatus = $('orbstatus'), docSec = $('doc'), aiSec = $('ai'),
      qIn = $('q'), docTitle = $('doctitle'), docCount = $('doccount'),
      trackSel = $('track'), tlangIn = $('tlang'), tlangsDl = $('tlangs');

async function loadTracks() {
  const url = f.url.value.trim();
  if (!url) return false;
  if (url === state.tracksUrl) return true;
  orb.set('fetch');
  orbstatus.textContent = 'Recherche des pistes…';
  try {
    const d = await fetchTracks(url);
    state.tracksUrl = url;
    trackSel.innerHTML = d.tracks.map((t) =>
      `<option value="${t.vssId}">${t.label} [${t.code}${t.kind === 'asr' ? ' · auto' : ''}]</option>`).join('');
    tlangsDl.innerHTML = d.translations.map((t) =>
      `<option value="${t.code}">${t.label}</option>`).join('');
    opts.classList.add('on');
    orbstatus.textContent = 'Prêt — lance la transcription';
    return true;
  } catch (err) {
    fail(err.message, err.raw ? JSON.stringify(err.raw) : err.message);
    orb.set('err');
    orbstatus.textContent = 'Erreur';
    return false;
  }
}

let debounce = null;
f.url.addEventListener('input', () => {
  state.tracksUrl = null;
  clearTimeout(debounce);
  debounce = setTimeout(loadTracks, 600);
});
f.url.addEventListener('change', loadTracks);

f.onsubmit = async (e) => {
  e.preventDefault();
  clearErr();
  $('out').innerHTML = '';
  docSec.classList.remove('on');
  aiSec.classList.remove('on');
  $('llmout').style.display = 'none';
  $('thinkdetails').style.display = 'none';
  const m = f.url.value.trim().match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})|^([\w-]{11})$/);
  state.lastId = m ? (m[1] || m[2]) : '';
  if (!await loadTracks()) return;
  orb.set('fetch');
  orbstatus.textContent = 'Téléchargement du transcript…';
  st.textContent = '';
  try {
    const d = await fetchTranscript(
      f.url.value.trim(), trackSel.value, tlangIn.value.trim() || null);
    state.current = d.segments;
    state.lastTitle = d.title || d.videoId;
    docTitle.textContent = state.lastTitle;
    docTitle.title = state.lastTitle;
    docCount.textContent = `piste ${d.language}${d.translated ? ' → ' + d.translated : ''} · ${d.kind === 'asr' ? 'auto' : 'manuelle'} · ${d.segments.length} segments`;
    docSec.classList.add('on');
    aiSec.classList.add('on');
    orb.set('idle');
    orbstatus.textContent = 'Transcript prêt';
    state.tsOn = true;
    render(true);
    bindDocActions(render);
    qIn.value = '';
    qIn.oninput = () => render(state.tsOn);
    renderTplBar();
    autoRunTpl();
    toast('transcript chargé');
  } catch (err) {
    fail(err.message, err.raw ? JSON.stringify(err.raw) : err.message);
    orb.set('err');
    orbstatus.textContent = 'Erreur';
  }
};

// --- init ---
initAdmin();
initTplBar();

if (Q.has('fixture')) {
  $('demo').style.display = 'inline';
  f.url.value = 'https://youtu.be/dQw4w9WgXcQ';
  loadTracks().then((ok) => { if (ok && Q.has('auto')) f.requestSubmit(); });
}

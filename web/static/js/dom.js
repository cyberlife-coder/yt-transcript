// Utilitaires DOM et état partagé de l'application.

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// --- état global mutable (module singleton) ---
export const state = {
  current: [],        // segments du transcript courant
  tracksUrl: null,    // URL pour laquelle les pistes sont chargées
  lastTitle: '',
  lastId: '',
  busy: false,
  tsOn: true,
  fixture: new URLSearchParams(location.search).has('fixture'),
};

export const Q = new URLSearchParams(location.search);

// --- toast ---
let toastT = null;
const toastEl = () => $('toast');
export function toast(m) {
  const el = toastEl();
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

// --- erreur ---
export function fail(msg, raw) {
  $('errtxt').textContent = msg;
  $('errraw').textContent = raw || '';
  $('errbox').classList.add('on');
}
export function clearErr() {
  $('errbox').classList.remove('on');
}

export function fmt(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function ytLink(sec) {
  return `https://youtu.be/${state.lastId}?t=${Math.floor(sec)}`;
}

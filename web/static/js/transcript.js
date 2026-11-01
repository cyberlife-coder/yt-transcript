// Rendu du transcript groupé par fenêtres de 60 s.
import { $, esc, state, fmt, ytLink } from './dom.js';

export function render(withTs) {
  const q = $('q').value.trim().toLowerCase();
  const out = $('out');
  let html = '', grp = [], gt = null, shown = 0;
  const flush = () => {
    if (!grp.length) return;
    const body = grp.map((s) => esc(s.text)).join(' ');
    const hide = q && !body.toLowerCase().includes(q);
    if (!hide) shown++;
    const bodyHtml = q
      ? body.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>')
      : body;
    html += `<div class="grp${hide ? ' hide' : ''}">` +
      (withTs
        ? `<a class="grp-ts" href="${ytLink(gt)}" target="_blank" rel="noopener" title="ouvrir dans YouTube">${fmt(gt)}</a>`
        : `<span class="grp-ts"></span>`) +
      `<div class="grp-tx">${bodyHtml}</div></div>`;
    grp = [];
  };
  for (const s of state.current) {
    const w = Math.floor(s.start / 60) * 60;
    if (gt === null) gt = w;
    if (w !== gt) { flush(); gt = w; }
    grp.push(s);
  }
  flush();
  out.innerHTML = html;
  $('nomatch').classList.toggle('on', q && !shown);
}

export function bindDocActions(onToggleTs) {
  $('c2').onclick = () => { state.tsOn = !state.tsOn; onToggleTs(state.tsOn); };
  $('c1').onclick = () => {
    navigator.clipboard.writeText(state.current.map((s) => s.text).join(' '));
  };
  $('c3').onclick = () => {
    const body = state.current.map((s) => `[${fmt(s.start)}] ${s.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['# ' + state.lastTitle + '\n\n' + body], { type: 'text/markdown' }));
    a.download = (state.lastId || 'transcript') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

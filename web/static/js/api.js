// Client API — toutes les requêtes fetch vers le backend.
import { state, Q } from './dom.js';

function apiqs(extra) {
  const p = new URLSearchParams(extra);
  if (state.fixture) p.set('fixture', '1');
  return p;
}

export async function fetchTracks(url) {
  const r = await fetch('/api/tracks?' + apiqs({ url }));
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error || ('HTTP ' + r.status)), { raw: d });
  return d;
}

export async function fetchTranscript(url, vss, tlang) {
  const p = apiqs({ url, vss });
  if (tlang) p.set('tlang', tlang);
  const r = await fetch('/api/transcript?' + p);
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error || ('HTTP ' + r.status)), { raw: d });
  return d;
}

export async function fetchModels(endpoint, apiKey) {
  const r = await fetch('/api/llm/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, apiKey, fixture: state.fixture }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d.models;
}

export async function* streamLLM({ endpoint, apiKey, model, system, user }) {
  const body = JSON.stringify({
    endpoint, apiKey, model, fixture: state.fixture, system, user, stream: true,
  });
  const r = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || ('HTTP ' + r.status));
  }
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const pay = line.slice(5).trim();
      if (!pay || pay === '[DONE]') continue;
      try { yield JSON.parse(pay); } catch { /* ignore */ }
    }
  }
}

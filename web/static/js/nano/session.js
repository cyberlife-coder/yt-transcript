// Session Gemini Nano — création, streaming avec watchdog, métriques.
// Dépend de l'API LanguageModel (injectable pour les tests).
import { NANO_CFG, NanoError } from './config.js';

/** Retourne l'API LanguageModel (ou null). Injectable via setLanguageModel pour les tests. */
let _lm = null;
export function setLanguageModel(lm) { _lm = lm; }
export function nanoApi() { return _lm || self.LanguageModel || null; }

// Langues supportées par l'API (Chrome : de, en, es, fr, ja uniquement).
const LANGS_IN = ['en', 'fr'];
const LANGS_OUT = ['fr'];
const EXPECTED = {
  expectedInputs: [{ type: 'text', languages: LANGS_IN }],
  expectedOutputs: [{ type: 'text', languages: LANGS_OUT }],
};

/** Diagnostic de disponibilité — utilisé par l'UI admin.
 *  Les langues sont passées AUSSI à availability() (recommandation Chrome :
 *  sinon warning « No output language was specified »). */
export async function nanoStatus() {
  const L = nanoApi();
  if (!L) return { ok: false, st: 'absent', msg: 'API absente — nécessite Chrome ≥138 (ou flag #prompt-api-for-gemini-nano)' };
  try {
    const a = await L.availability(EXPECTED);
    if (a === 'available' || a === 'readily') return { ok: true, st: 'available', msg: 'Gemini Nano prêt (modèle embarqué)' };
    if (a === 'downloadable') return { ok: true, st: 'downloadable', msg: 'modèle à télécharger (~3 Go) — lance un template pour démarrer' };
    if (a === 'downloading') return { ok: true, st: 'downloading', msg: 'téléchargement du modèle en cours…' };
    return { ok: false, st: a, msg: 'Gemini Nano indisponible sur cet appareil (' + a + ')' };
  } catch (e) { return { ok: false, st: 'err', msg: 'Gemini Nano : ' + e.message }; }
}

/**
 * Crée une session Nano. `onDownload(ratio)` est appelé à chaque
 * downloadprogress (0..1) — branché sur la gauge admin.
 */
export async function nanoSession(sys, onDownload) {
  const L = nanoApi();
  if (!L) throw new NanoError('absent', 'Prompt API absente — Chrome ≥138 requis (ou flag #prompt-api-for-gemini-nano)');
  // availability() AVEC les langues : évite le warning « No output language specified ».
  const a = await L.availability(EXPECTED);
  if (a === 'unavailable') throw new NanoError('unavailable', 'Gemini Nano indisponible sur cet appareil');
  return L.create({
    initialPrompts: [{ role: 'system', content: sys }],
    ...EXPECTED,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        if (onDownload) onDownload(e.loaded || 0);
      });
    },
  });
}

/**
 * Stream une réponse avec watchdog anti-silence et détection de boucle.
 * IMPORTANT : selon les versions de Chrome, les chunks de promptStreaming sont
 * des DELTAS (nouveaux tokens) ou le texte CUMULATIF — on détecte au 2e chunk
 * et on accumule en conséquence.
 * Retourne { text, metrics }. Session neuve par appel.
 */
export async function nanoAttempt(sys, input, render, onDownload) {
  const t0 = performance.now();
  const session = await nanoSession(sys, onDownload);
  const it = session.promptStreaming(input)[Symbol.asyncIterator]();
  const timeout = () => new Promise((_, rj) => setTimeout(
    () => rj(new NanoError('timeout', `stream Nano muet ${NANO_CFG.STREAM_TIMEOUT_MS / 1000} s`)),
    NANO_CFG.STREAM_TIMEOUT_MS));
  let ans = '', n = 0, chunks = 0, cumulative = null, looped = false, capped = false;
  try {
    for (;;) {
      const step = await Promise.race([it.next(), timeout()]);
      if (step.done) break;
      chunks++;
      const chunk = step.value;
      if (cumulative === null && chunks === 2) {
        // chunk 2 starts with chunk 1 → cumulatif ; sinon deltas
        cumulative = chunk.startsWith(ans);
      }
      ans = (cumulative === false) ? ans + chunk : chunk;
      if (render && ++n % NANO_CFG.RENDER_THROTTLE === 0) render(ans);
      if (ans.length > NANO_CFG.MAX_OUTPUT_CHARS) { capped = true; break; }
      const tail = ans.slice(-NANO_CFG.LOOP_TAIL);
      if (tail.length === NANO_CFG.LOOP_TAIL &&
          ans.indexOf(tail) !== ans.length - NANO_CFG.LOOP_TAIL) {
        looped = true;
        break;
      }
    }
    if (render) render(ans);
    if (looped) throw new NanoError('loop', 'boucle infinie détectée (répétition)');
    return {
      text: ans,
      metrics: {
        ms: Math.round(performance.now() - t0),
        chunks,
        chars: ans.length,
        capped,
        cumulative,
      },
    };
  } catch (e) {
    if (e instanceof NanoError) throw e;
    throw new NanoError('stream', (e && e.message) || String(e));
  } finally {
    try { it.return && it.return(); } catch { /* noop */ }
    if (session.destroy) { try { session.destroy(); } catch { /* noop */ } }
  }
}

/**
 * Ping de santé du modèle — distingue un modèle mort d'un souci de format :
 *  A) prompt() NON-streaming, sans system, array messages (forme doc officielle).
 *  B) promptStreaming avec system, array messages user.
 * Retourne { ok, strategy, text?, reason? }.
 */
export async function nanoPing(onDownload) {
  const L = nanoApi();
  if (!L) return { ok: false, reason: 'absent' };
  // A) non-streaming, sans system, array messages
  try {
    const s = await L.create({ ...EXPECTED });
    try {
      const r = await s.prompt([{ role: 'user', content: 'Réponds exactement : OK' }]);
      if (r && r.trim()) return { ok: true, strategy: 'prompt-nosys-messages', text: r };
    } finally {
      if (s.destroy) { try { s.destroy(); } catch { /* noop */ } }
    }
  } catch (e) {
    console.warn('[yt-t] nano ping A →', e.message);
  }
  // B) streaming avec system, array messages
  try {
    const r = await nanoAttempt('', [{ role: 'user', content: 'Réponds exactement : OK' }], null, onDownload);
    if (r.text && r.text.trim()) return { ok: true, strategy: 'stream-messages', text: r.text };
    return { ok: false, strategy: 'stream-messages', reason: 'stream vide ou contexte sérialisé seul', raw: r.text };
  } catch (e) {
    return { ok: false, strategy: 'stream-messages', reason: e.message };
  }
}

/**
 * Prompt — stratégies dans l'ordre de fiabilité constaté :
 *  1. ARRAY de messages [{role:'user',…}] — forme recommandée par la doc quand un
 *     system prompt est défini via initialPrompts (une string simple peut provoquer
 *     l'echo du contexte sérialisé « User:…End.Model: » sur certains builds).
 *  2. Prefix assistant « Réponse : » (marqueur final strippé du user content).
 *  3. String simple en dernier recours.
 * Chaque tentative = session neuve. Retourne { text, metrics, attempts }.
 */
export async function nanoPrompt(sys, userText, render, onDownload) {
  const attempts = [];
  let lastErr = null;
  // Tentative 1 : array messages user (recommandé avec initialPrompts)
  try {
    const r = await nanoAttempt(sys, [{ role: 'user', content: userText }], render, onDownload);
    attempts.push({ strategy: 'messages', ok: true, metrics: r.metrics });
    return { text: r.text, metrics: r.metrics, attempts };
  } catch (e) {
    lastErr = e;
    attempts.push({ strategy: 'messages', ok: false, error: e.message });
  }
  // Tentative 2 : préfixe assistant (marqueur final strippé du user content)
  try {
    const stripped = userText.replace(/\n?Réponse\s*:\s*$/, '');
    const r = await nanoAttempt(sys, [
      { role: 'user', content: stripped },
      { role: 'assistant', content: NANO_CFG.ASSISTANT_PREFIX, prefix: true },
    ], render, onDownload);
    attempts.push({ strategy: 'prefix', ok: true, metrics: r.metrics });
    return { text: r.text, metrics: r.metrics, attempts };
  } catch (e) {
    attempts.push({ strategy: 'prefix', ok: false, error: e.message });
  }
  // Tentative 3 : string simple
  try {
    const r = await nanoAttempt(sys, userText, render, onDownload);
    attempts.push({ strategy: 'plain', ok: true, metrics: r.metrics });
    return { text: r.text, metrics: r.metrics, attempts };
  } catch (e) {
    attempts.push({ strategy: 'plain', ok: false, error: e.message });
    throw lastErr && lastErr.kind === 'timeout' ? lastErr : e;
  }
}

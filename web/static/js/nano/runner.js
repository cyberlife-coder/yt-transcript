// Runner Gemini Nano — orchestration warm-up + map-reduce + synthèse finale.
// Toute la logique de découpe/retry/métriques vit ici, testable avec un mock LM.
import { NANO_CFG, NanoError } from './config.js';
import { nanoSession, nanoPrompt, nanoPing } from './session.js';
import {
  nanoTask, postProcess, packSegments, segsToText, reducePrompt,
  maxCharsFromQuota, isRetriable,
} from './guards.js';
import { fmt } from '../dom.js';
import { orb } from '../orb.js';

/**
 * Sonde la fenêtre de contexte réelle de Nano via inputQuota/inputUsage.
 * Le onDownload est propagé pour la gauge de téléchargement.
 */
export async function probeContext(sys, onDownload) {
  const session = await nanoSession(sys, onDownload);
  try {
    return maxCharsFromQuota(session.inputQuota, session.inputUsage);
  } finally {
    if (session.destroy) { try { session.destroy(); } catch { /* noop */ } }
  }
}

/**
 * Warm-up en 2 temps :
 *  1. PING de santé (nanoPing : prompt() non-streaming sans sys, puis streaming) —
 *     valide que le modèle génère AU MOINS quelque chose.
 *  2. Vrai nanoTask représentatif sur les premiers segments.
 * Loggue les réponses BRUTES (500 car) pour le diagnostic.
 * Lève NanoError('nomodel') si le modèle ne génère aucune complétion.
 */
export async function warmUp(sys, title, segs, t, onDownload) {
  // --- 1. ping de santé ---
  const ping = await nanoPing(onDownload);
  console.warn('[yt-t] nano ping →', JSON.stringify(ping));
  if (!ping.ok) {
    throw new NanoError('nomodel',
      'Gemini Nano ne génère aucune complétion (ping vide sur toutes les stratégies : ' +
      ping.strategy + ' — ' + (ping.reason || '') + '). ' +
      'Vérifie chrome://on-device-internals : le modèle « Optimization Guide On Device Model » ' +
      'est-il téléchargé (~3 Go) et finalisé ? Essaie aussi chrome://components → mettre à jour.');
  }

  // --- 2. warm-up représentatif ---
  const body = segsToText(segs.slice(0, NANO_CFG.WARMUP_SEGMENTS), fmt);
  const task = nanoTask(t, title, body, 'test');
  let lastErr = null;
  for (let i = 0; i <= NANO_CFG.WARMUP_RETRIES; i++) {
    try {
      const r = await nanoPrompt(sys, task, null, onDownload);
      console.warn('[yt-t] nano warm-up raw →', JSON.stringify((r.text || '').slice(0, 500)));
      const clean = postProcess(r.text, task);
      if (clean && clean.length > 10) {
        return { ok: true, sample: clean, metrics: r.metrics, attempts: r.attempts, ping };
      }
      lastErr = new NanoError('vide', 'warm-up trop court : « ' + clean.slice(0, 140) + ' »');
    } catch (e) {
      lastErr = e;
      if (e.kind === 'nomodel') throw e;
    }
  }
  // Vide/echo mais ping OK : le modèle répond, c'est le prompt qui coince.
  // On ne bloque pas — runNano continue, les erreurs par partie seront visibles.
  return { ok: false, pingOk: true, reason: (lastErr && lastErr.message) || 'réponse vide' };
}

/**
 * Map-reduce complet. Retourne { text, metrics }.
 * - sonde le contexte réel
 * - warm-up représentatif
 * - découpe en paquets, traite chaque paquet (avec re-découpage borné)
 * - synthèse finale (reduce)
 */
export async function runNano(sys, title, segs, hooks = {}) {
  const { onStatus, onProgress, onDownload, render } = hooks;
  const t0 = performance.now();
  const metrics = { packs: 0, partials: 0, fails: 0, repacks: 0, warmup: null };

  if (onStatus) onStatus('vérification du modèle…');
  orb.set('work', 0);

  const maxChars = await probeContext(sys, onDownload);
  metrics.maxChars = maxChars;

  const warm = await warmUp(sys, title, segs, hooks.template, onDownload);
  metrics.warmup = warm.ok ? warm.metrics : { ok: false, reason: warm.reason, ping: warm.ping };
  if (warm.ok) {
    console.warn('[yt-t] nano warm-up →', JSON.stringify(warm.sample.slice(0, 200)));
  } else {
    // ping OK mais warm-up vide : on continue quand même.
    console.warn('[yt-t] nano warm-up vide mais ping OK — on continue :', warm.reason);
    if (onStatus) onStatus('modèle OK, prompt de test vide — traitement…');
  }

  const queue = packSegments(segs, maxChars, fmt);
  metrics.packs = queue.length;

  // Fallback ultime : si un résultat est vide, retente avec un prompt DIRECT
  // (sans mise en forme nanoTask) — le 3B répond parfois mieux à une consigne nue.
  async function withDirectFallback(task, text) {
    if (text && text.trim().length > 0) return text;
    const direct = `${hooks.template.prompt}\n\nTexte à analyser :\n${segsToText(segs, fmt).slice(0, maxChars)}\n\nRéponse :`;
    try {
      const r = await nanoPrompt(sys, direct, render, onDownload);
      return postProcess(r.text, direct);
    } catch { return text; }
  }

  // Cas simple : un seul paquet → pas de reduce
  if (queue.length <= 1) {
    orb.set('work', 0.5);
    const task = nanoTask(hooks.template, title, segsToText(segs, fmt));
    const r = await nanoPrompt(sys, task, render, onDownload);
    const text = await withDirectFallback(task, postProcess(r.text, task));
    return { text, metrics: { ...metrics, ms: Math.round(performance.now() - t0) } };
  }

  const partials = [];
  let fails = 0;
  for (let i = 0; i < queue.length; i++) {
    if (onStatus) onStatus(`partie ${i + 1}/${queue.length}…`);
    orb.set('work', i / queue.length);
    const body = segsToText(queue[i], fmt);
    const task = nanoTask(hooks.template, title, body, `partie ${i + 1}/${queue.length}`);
    try {
      const r = await nanoPrompt(sys, task, render, onDownload);
      partials.push(postProcess(r.text, task) || '_(partie vide)_');
      metrics.partials++;
    } catch (e) {
      if (isRetriable(e) && queue[i].length > 4 && metrics.repacks < NANO_CFG.MAX_REPACK) {
        metrics.repacks++;
        const p = queue[i], mid = p.length >> 1;
        queue.splice(i, 1, p.slice(0, mid), p.slice(mid));
        i--;
        continue;
      }
      fails++;
      metrics.fails = fails;
      partials.push(`_(partie ${i + 1} illisible : ${e.message || e})_`);
      if (fails > NANO_CFG.MAX_FAILS) {
        throw new NanoError('mapreduce',
          'Nano échoue systématiquement sur ce transcript — repasse en moteur « serveur » pour les longues vidéos');
      }
    }
    if (render) render(partials.join('\n\n'));
  }

  if (onStatus) onStatus('synthèse finale…');
  orb.set('reduce');
  const redTask = reducePrompt(title, partials, maxChars);
  const r = await nanoPrompt(sys, redTask, render, onDownload);
  const text = await withDirectFallback(redTask, postProcess(r.text, redTask));
  return {
    text,
    metrics: { ...metrics, ms: Math.round(performance.now() - t0) },
  };
}

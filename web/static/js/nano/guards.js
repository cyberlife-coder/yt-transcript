// Guards Gemini Nano — fonctions PURES, zéro dépendance DOM/API.
// Testables unitairement avec node.
import { NANO_CFG, NanoError } from './config.js';

/** Construit le prompt « tâche » : transcript en tête, consigne en position terminale.
 *  Le marqueur final « Réponse : » sert UNIQUEMENT au fallback « plain string » ;
 *  avec le prefix assistant, nanoPrompt le strippe pour éviter le double marqueur. */
export function nanoTask(t, title, body, tag) {
  return `Transcription horodatée de « ${title} »` + (tag ? ` (${tag})` : '') +
    `, à analyser sans la répéter :\n\n${body}\n\nConsigne : ${t.prompt}` +
    `\nRéponse :`;
}

/** Strippe le marqueur final « Réponse : » (utilisé avant un prefix assistant). */
export function stripTrailingMarker(text) {
  return (text || '').replace(/\n?Réponse\s*:\s*$/, '');
}

/** Détecte si la réponse est un simple echo du prompt. */
export function isEcho(ans, prompt) {
  if (!ans) return false;
  const probe = ans.slice(0, 120).trim();
  return probe.length > 50 && prompt.includes(probe);
}

/** Détecte le stub CPU (modèle non téléchargé/finalisé). */
export function isCpuStub(ans) {
  return /\bCPU backend\b/i.test(ans || '');
}

/** Extrait la réponse après le marqueur « Model: »/« End. » — MAIS seulement si le
 *  texte avant le marqueur ressemble à du contexte sérialisé (présence de « User: »
 *  ou « End. »). Un « Model: » dans une vraie réponse ne doit PAS tronquer. */
export function extractAfterMarker(ans) {
  if (!ans || !/\bEnd\s*\.|\bModel\s*:/.test(ans)) return ans;
  const re = /(?:End\s*\.\s*)?Model\s*:\s*/g;
  let m, last = null, lastIdx = -1;
  while ((m = re.exec(ans)) !== null) { last = m; lastIdx = m.index; }
  if (!last) return ans;
  const before = ans.slice(0, lastIdx);
  if (!/\bUser\s*:|\bEnd\s*\./.test(before)) return ans; // pas du contexte sérialisé → intact
  return ans.slice(lastIdx + last[0].length);
}

/** Nettoie les artefacts de sérialisation du contexte. */
export function cleanArtifacts(ans) {
  return (ans || '')
    .replace(/^\s*(User|Assistant|System|Model|End)\s*[:.]\s*/gim, '')
    .replace(/^\s*Réponse\s*:\s*/, '')
    .trim();
}

/** Pipeline complet de post-traitement d'une réponse brute Nano.
 *  - Contexte sérialisé « User: … End. Model: <suite> » → on garde <suite> ; si <suite>
 *    est vide (le modèle n'a rien généré), retourne '' proprement.
 *  - Réponse directe → nettoyage classique.
 *  - Jamais de faux positif : un raw qui n'est QUE du contexte sérialisé = réponse vide. */
export function postProcess(raw, userText) {
  if (!raw) return '';
  if (isCpuStub(raw)) {
    throw new NanoError('nomodel',
      'modèle non finalisé (exécuteur CPU stub) — chrome://components → ' +
      '« Optimization Guide On Device Model », vérifier le téléchargement ~3 Go');
  }
  // Cas 1 : le stream contient le contexte sérialisé « User: … End. Model: … »
  const ser = /(?:^|\n)User\s*:[\s\S]*?End\s*\.\s*Model\s*:\s*/i.exec(raw);
  if (ser) {
    const ans = cleanArtifacts(raw.slice(ser.index + ser[0].length));
    if (!ans) return ''; // rien après le marqueur → le modèle n'a rien généré
    if (isEcho(ans, userText)) {
      throw new NanoError('echo', 'Nano a répété le prompt — « ' + ans.slice(0, 90) + ' »');
    }
    return ans;
  }
  // Cas 2 : réponse directe
  const ans = cleanArtifacts(raw);
  if (ans && isEcho(ans, userText)) {
    throw new NanoError('echo', 'Nano a répété le prompt — « ' + ans.slice(0, 90) + ' »');
  }
  return ans;
}

/** Découpe les segments en paquets ≤ maxChars (map-reduce). */
export function packSegments(segs, maxChars, fmtFn) {
  const packs = [];
  let cur = [], len = 0;
  for (const s of segs) {
    const piece = `[${fmtFn(s.start)}] ${s.text}`;
    if (cur.length && len + piece.length > maxChars) {
      packs.push(cur); cur = []; len = 0;
    }
    cur.push(s);
    len += piece.length;
  }
  if (cur.length) packs.push(cur);
  return packs;
}

/** Formate les segments en texte horodaté. */
export function segsToText(segs, fmtFn) {
  return segs.map((s) => `[${fmtFn(s.start)}] ${s.text}`).join(' ');
}

/** Construit le prompt de synthèse finale (reduce). */
export function reducePrompt(title, partials, maxChars) {
  const reduceTask =
    'On te donne plusieurs résultats partiels déjà produits sur les ' +
    'différentes parties d’une même vidéo. Fusionne-les en UN seul résultat final cohérent, ' +
    'sans doublons, en conservant l’ordre chronologique et les timestamps si présents. ' +
    'Ne répète pas les en-têtes « Partie N ».';
  const joined = partials.map((p, i) => `— Partie ${i + 1} —\n${p}`).join('\n\n');
  return nanoTask({ prompt: reduceTask }, title, joined.slice(0, maxChars));
}

/** Calcule la taille max d'un paquet depuis le quota réel de la session. */
export function maxCharsFromQuota(quota, used) {
  return Math.max(
    NANO_CFG.MIN_PACK_CHARS,
    Math.floor(((quota || NANO_CFG.DEFAULT_QUOTA) - (used || 0)) *
               NANO_CFG.CONTEXT_SAFETY * NANO_CFG.CHARS_PER_TOKEN));
}

/** Un paquet est-il re-triable (erreur de quota/contexte) ? */
export function isRetriable(err) {
  return /too large|quota|context|echo:/i.test((err && err.message) || '');
}

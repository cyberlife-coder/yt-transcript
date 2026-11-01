// Tests unitaires Gemini Nano — mock LanguageModel, zéro dépendance navigateur.
// Lancer : node --test tests-js/
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- polyfills navigateur minimaux ---
globalThis.performance = { now: () => Date.now() };
globalThis.self = globalThis;

// --- imports des modules à tester ---
const { NANO_CFG, NanoError } = await import('../web/static/js/nano/config.js');
const guards = await import('../web/static/js/nano/guards.js');
const session = await import('../web/static/js/nano/session.js');

// ---------- helpers mock ----------
function mockLM({ availability = 'available', chunks = ['Réponse :\nHello world.'], quota = 4096, used = 0, delay = 0, hangAfter = null } = {}) {
  const sessions = [];
  const LM = {
    async availability() { return availability; },
    async create(opts) {
      const s = {
        inputQuota: quota,
        inputUsage: used,
        destroyed: false,
        destroy() { this.destroyed = true; },
        promptStreaming(input) {
          const out = chunks.slice();
          let i = 0;
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  if (hangAfter !== null && i >= hangAfter) {
                    // simule un stream muet : ne résout jamais (le watchdog doit tuer)
                    await new Promise(() => {});
                  }
                  if (delay) await new Promise((r) => setTimeout(r, delay));
                  if (i >= out.length) return { done: true, value: undefined };
                  return { done: false, value: out[i++] };
                },
                return() { return { done: true }; },
              };
            },
          };
        },
        _opts: opts,
      };
      sessions.push(s);
      return s;
    },
    _sessions: sessions,
  };
  return LM;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ==================== GUARDS ====================

test('nanoTask : transcript en tête, consigne en queue, marqueur Réponse', () => {
  const t = guards.nanoTask({ prompt: 'Résume.' }, 'Titre', 'body', 'partie 1/3');
  assert.ok(t.includes('« Titre »'));
  assert.ok(t.includes('(partie 1/3)'));
  assert.ok(t.includes('Consigne : Résume.'));
  assert.ok(t.endsWith('\nRéponse :'));
  assert.ok(t.indexOf('body') < t.indexOf('Consigne')); // transcript AVANT consigne
});

test('isEcho : détecte la répétition du prompt', () => {
  const prompt = 'Voici une longue transcription horodatée de la vidéo test avec plein de texte.';
  assert.equal(guards.isEcho(prompt.slice(0, 100), prompt), true);
  assert.equal(guards.isEcho('Une réponse normale et différente.', prompt), false);
  assert.equal(guards.isEcho('', prompt), false);
  assert.equal(guards.isEcho('court', prompt), false);
});

test('isCpuStub : détecte le stub CPU', () => {
  assert.equal(guards.isCpuStub('CPU backend not available'), true);
  assert.equal(guards.isCpuStub('cpu backend stub'), true);
  assert.equal(guards.isCpuStub('réponse normale'), false);
});

test('extractAfterMarker : garde ce qui suit le DERNIER Model: du contexte sérialisé', () => {
  const raw = 'User: foo End. Model: bla Model: réponse finale ici';
  assert.equal(guards.extractAfterMarker(raw), 'réponse finale ici');
  assert.equal(guards.extractAfterMarker('pas de marqueur'), 'pas de marqueur');
});

test('extractAfterMarker : ne tronque PAS un Model: dans une vraie réponse', () => {
  // Pas de « User: » ni « End. » avant → ce n'est pas du contexte sérialisé
  const real = 'Le Model: 3B a été affiné sur ce corpus. Voici le résumé.';
  assert.equal(guards.extractAfterMarker(real), real);
  const real2 = 'Voici la réponse. Model: 3B fait 3 milliards de paramètres.';
  assert.equal(guards.extractAfterMarker(real2), real2);
});

test('stripTrailingMarker : enlève le marqueur final Réponse :', () => {
  assert.equal(guards.stripTrailingMarker('texte\nRéponse :'), 'texte');
  assert.equal(guards.stripTrailingMarker('texte\nRéponse :\n'), 'texte');
  assert.equal(guards.stripTrailingMarker('texte sans marqueur'), 'texte sans marqueur');
  assert.equal(guards.stripTrailingMarker('Réponse : en plein milieu'), 'Réponse : en plein milieu');
});

test('nanoPrompt : stratégie messages-array en premier, prefix en fallback sans double marqueur', async () => {
  let call = 0;
  const seenInputs = [];
  const lm = {
    async availability() { return 'available'; },
    async create() {
      call++;
      const failMessages = call === 1;
      return {
        destroy() {},
        promptStreaming(input) {
          seenInputs.push(input);
          if (failMessages) {
            return { [Symbol.asyncIterator]() { return {
              async next() { throw new Error('messages échoue'); },
              return() { return { done: true }; },
            }; } };
          }
          const out = ['OK via prefix'];
          let i = 0;
          return { [Symbol.asyncIterator]() { return {
            async next() { return i < out.length ? { done: false, value: out[i++] } : { done: true }; },
            return() { return { done: true }; },
          }; } };
        },
      };
    },
  };
  session.setLanguageModel(lm);
  const task = guards.nanoTask({ prompt: 'Résume.' }, 'Titre', 'body', 'test'); // finit par « Réponse : »
  const r = await session.nanoPrompt('sys', task, null);
  assert.ok(r.text.includes('OK via prefix'));
  assert.equal(r.attempts[0].strategy, 'messages');
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.attempts[1].strategy, 'prefix');
  assert.equal(r.attempts[1].ok, true);
  // Tentative 1 (messages) : array [{role:'user', content: task}] — forme doc officielle
  assert.ok(Array.isArray(seenInputs[0]));
  assert.equal(seenInputs[0][0].role, 'user');
  assert.equal(seenInputs[0][0].content, task);
  // Tentative 2 (prefix) : user content SANS marqueur final, prefix ajouté
  const userContent = seenInputs[1][0].content;
  assert.ok(!/Réponse\s*:\s*$/.test(userContent), `double marqueur: ${JSON.stringify(userContent.slice(-30))}`);
  assert.equal(seenInputs[1][1].content, 'Réponse :\n');
  assert.equal(seenInputs[1][1].prefix, true);
});

test('cleanArtifacts : nettoie les préfixes de rôle en début de ligne', () => {
  // chaque ligne commençant par User:/Model:/etc est nettoyée
  assert.equal(guards.cleanArtifacts('User: x\nModel: y\nhello'), 'x\ny\nhello');
  assert.equal(guards.cleanArtifacts('  Réponse :\n  hello world  '), 'hello world');
  assert.equal(guards.cleanArtifacts('Model: hello'), 'hello');
});

test('postProcess : lève NanoError nomodel sur CPU stub', () => {
  assert.throws(() => guards.postProcess('CPU backend stub', 'prompt'), (e) => e.kind === 'nomodel');
});

test('postProcess : lève NanoError echo sur répétition', () => {
  const longPrompt = 'a'.repeat(200);
  assert.throws(() => guards.postProcess(longPrompt.slice(0, 100), longPrompt), (e) => e.kind === 'echo');
});

test('postProcess : réponse propre retournée nettoyée', () => {
  const out = guards.postProcess('Réponse :\nVoici le résumé.', 'prompt');
  assert.equal(out, 'Voici le résumé.');
});

test('postProcess : contexte sérialisé « User:…End.Model: » + vraie réponse → extrait la réponse', () => {
  const raw = 'User: foo bar End. Model: voici le résumé demandé';
  assert.equal(guards.postProcess(raw, 'foo bar'), 'voici le résumé demandé');
});

test('postProcess : contexte sérialisé sans rien après le marqueur → chaîne VIDE (pas de faux positif)', () => {
  // C'est exactement ce que renvoie le 3B quand il ne génère rien après le prefix.
  const raw = 'User: Tu es un assistant. Réponds exactement : OK End.Model: Réponse :\n';
  assert.equal(guards.postProcess(raw, 'Tu es un assistant. Réponds exactement : OK'), '');
});

test('postProcess : réponse directe contenant « Model: » sans contexte sérialisé → intacte', () => {
  const raw = 'Le Model: 3B fait 3 milliards de paramètres.';
  assert.equal(guards.postProcess(raw, 'prompt'), raw);
});

test('packSegments : découpe par taille', () => {
  const segs = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, text: 'x'.repeat(100) }));
  const packs = guards.packSegments(segs, 250, fmt);
  assert.ok(packs.length >= 3);
  // chaque pack ≤ 250 + un segment de marge
  for (const p of packs) {
    const len = p.reduce((a, s) => a + `[${fmt(s.start)}] ${s.text}`.length, 0);
    assert.ok(len <= 250 + 130, `pack trop gros: ${len}`);
  }
  // tous les segments présents
  assert.equal(packs.flat().length, 10);
});

test('maxCharsFromQuota : calcul avec marge de sécurité', () => {
  // quota 4096, used 0 → 4096 * 0.8 * 2.2 = 7208
  assert.equal(guards.maxCharsFromQuota(4096, 0), Math.floor(4096 * 0.8 * 2.2));
  // plancher MIN_PACK_CHARS
  assert.equal(guards.maxCharsFromQuota(100, 0), NANO_CFG.MIN_PACK_CHARS);
});

test('isRetriable : matche quota/echo/too large', () => {
  assert.equal(guards.isRetriable(new Error('too large for context')), true);
  assert.equal(guards.isRetriable(new Error('echo: ...')), true);
  assert.equal(guards.isRetriable(new Error('timeout random')), false);
});

// ==================== SESSION ====================

test('nanoStatus : absent sans LanguageModel', async () => {
  session.setLanguageModel(null);
  globalThis.LanguageModel = undefined;
  const s = await session.nanoStatus();
  assert.equal(s.ok, false);
  assert.equal(s.st, 'absent');
});

test('nanoStatus : available', async () => {
  session.setLanguageModel(mockLM({ availability: 'available' }));
  const s = await session.nanoStatus();
  assert.equal(s.ok, true);
  assert.equal(s.st, 'available');
});

test('nanoAttempt : stream deltas accumulés (comportement delta)', async () => {
  const lm = mockLM({ chunks: ['Réponse :\nBonjour ', 'le monde.'] });
  session.setLanguageModel(lm);
  const r = await session.nanoAttempt('sys', 'prompt', null);
  // chunks = deltas → on accumule
  assert.equal(r.text, 'Réponse :\nBonjour le monde.');
  assert.equal(r.metrics.cumulative, false);
  assert.equal(r.metrics.chunks, 2);
  assert.equal(lm._sessions[0].destroyed, true);
});

test('nanoAttempt : stream cumulatif (comportement cumulatif)', async () => {
  const lm = mockLM({ chunks: ['Bonjour', 'Bonjour le monde.'] });
  session.setLanguageModel(lm);
  const r = await session.nanoAttempt('sys', 'p', null);
  // chunk 2 commence par chunk 1 → cumulatif → on garde le dernier
  assert.equal(r.text, 'Bonjour le monde.');
  assert.equal(r.metrics.cumulative, true);
});

test('nanoAttempt : cap à MAX_OUTPUT_CHARS', async () => {
  const lm = mockLM({ chunks: ['x'.repeat(NANO_CFG.MAX_OUTPUT_CHARS + 100)] });
  session.setLanguageModel(lm);
  const r = await session.nanoAttempt('sys', 'p', null);
  assert.equal(r.metrics.capped, true);
  assert.ok(r.text.length > NANO_CFG.MAX_OUTPUT_CHARS);
});

test('nanoAttempt : détection de boucle (tail répété)', async () => {
  // Simule une boucle : le même tail apparaît 2 fois non consécutif
  const tail = 'boucle infinie '.repeat(20); // 300 car > LOOP_TAIL
  const chunks = ['A' + tail, 'B' + tail]; // tail présent 2 fois
  const lm = mockLM({ chunks });
  session.setLanguageModel(lm);
  await assert.rejects(() => session.nanoAttempt('sys', 'p', null), (e) => e.kind === 'loop');
});

test('nanoPrompt : fallback prefix → plain si plain lève une exception', async () => {
  // renommé : plain d'abord ; si plain échoue, tente prefix
  let call = 0;
  const lm = {
    async availability() { return 'available'; },
    async create() {
      call++;
      const failFirst = call === 1;
      return {
        destroy() {},
        promptStreaming() {
          let i = 0;
          if (failFirst) {
            return { [Symbol.asyncIterator]() { return {
              async next() { throw new Error('session polluée'); },
              return() { return { done: true }; },
            }; } };
          }
          const out = ['Réponse :\nOK fallback'];
          return { [Symbol.asyncIterator]() { return {
            async next() { return i < out.length ? { done: false, value: out[i++] } : { done: true }; },
            return() { return { done: true }; },
          }; } };
        },
      };
    },
  };
  session.setLanguageModel(lm);
  const r = await session.nanoPrompt('sys', 'prompt court\nRéponse :', null);
  assert.ok(r.text.includes('OK fallback'));
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].strategy, 'messages'); // 1re stratégie = messages array
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.attempts[0].error, 'session polluée');
  assert.equal(r.attempts[1].strategy, 'prefix');
  assert.equal(r.attempts[1].ok, true);
});

test('nanoSession : lève NanoError absent sans LM', async () => {
  session.setLanguageModel(null);
  globalThis.LanguageModel = undefined;
  await assert.rejects(() => session.nanoSession('sys'), (e) => e.kind === 'absent');
});

test('nanoSession : propage onDownload via monitor', async () => {
  let downloaded = null;
  const lm = {
    async availability() { return 'downloadable'; },
    async create(opts) {
      // simule un monitor qui émet downloadprogress
      const m = { addEventListener: (ev, cb) => { if (ev === 'downloadprogress') setTimeout(() => cb({ loaded: 0.42 }), 0); } };
      if (opts.monitor) opts.monitor(m);
      return { destroy() {}, promptStreaming() { return { [Symbol.asyncIterator]() { return { async next() { return { done: true }; }, return() { return { done: true }; } }; } }; } };
    },
  };
  session.setLanguageModel(lm);
  await session.nanoSession('sys', (r) => { downloaded = r; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(downloaded, 0.42);
});

console.log('✓ tests-js/nano.test.js chargé');

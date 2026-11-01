// Tests du runner Nano (map-reduce) avec mock LM.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance = { now: () => Date.now() };
globalThis.self = globalThis;

// --- stubs DOM minimaux (orb.js et dom.js touchent document/matchMedia au niveau module) ---
globalThis.matchMedia = () => ({ matches: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.document = {
  getElementById: () => ({
    getContext: () => ({
      clearRect() {}, createRadialGradient: () => ({ addColorStop() {} }),
      beginPath() {}, arc() {}, fill() {}, fillRect() {}, stroke() {},
      set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {},
    }),
    width: 264,
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.addEventListener = () => {};
globalThis.location = { search: '' };
globalThis.URLSearchParams = URLSearchParams;

// Stub des modules DOM-dépendants (orb, dom) avant import du runner.
// On utilise un import dynamique après avoir défini les stubs.
const session = await import('../web/static/js/nano/session.js');
const runner = await import('../web/static/js/nano/runner.js');
const { NANO_CFG } = await import('../web/static/js/nano/config.js');

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function mockLMStream(chunksPerCall, opts = {}) {
  let call = 0;
  return {
    async availability() { return opts.availability || 'available'; },
    async create(o) {
      const myChunks = typeof chunksPerCall === 'function' ? chunksPerCall(call) : chunksPerCall;
      call++;
      return {
        inputQuota: opts.quota ?? 4096,
        inputUsage: opts.used ?? 0,
        destroy() {},
        promptStreaming() {
          let i = 0;
          return { [Symbol.asyncIterator]() { return {
            async next() { return i < myChunks.length ? { done: false, value: myChunks[i++] } : { done: true }; },
            return() { return { done: true }; },
          }; } };
        },
      };
    },
    _calls: () => call,
  };
}

// Segments factices : 20 segments de ~200 car → plusieurs paquets avec quota 4096
// maxChars = 4096*0.8*2.2 ≈ 7208 → un seul pack. On force un petit quota pour tester le map-reduce.
const segs = Array.from({ length: 20 }, (_, i) => ({ start: i * 5, text: 'Lorem ipsum dolor sit amet '.repeat(8) }));

test('runNano : un seul paquet (quota large) → pas de reduce', async () => {
  const lm = mockLMStream((call) => {
    // call 0 = probe (pas de prompt), call 1 = warm-up, call 2 = traitement final
    if (call <= 1) return ['ok'];
    return ['Réponse :\nrésultat final unique'];
  }, { quota: 8192 });
  session.setLanguageModel(lm);
  const r = await runner.runNano('sys', 'Titre', segs, { template: { prompt: 'Résume.' } });
  assert.equal(r.text, 'résultat final unique');
  assert.equal(r.metrics.packs, 1);
  assert.ok(r.metrics.ms >= 0);
});

test('runNano : map-reduce avec petit quota → plusieurs paquets + reduce', async () => {
  const lm = mockLMStream((call) => {
    if (call === 0) return ['probe']; // sonde quota
    if (call === 1) return ['Réponse :\nwarm-up représentatif suffisamment long pour valider le modèle'];
    return ['Réponse :\nrésultat partiel de la partie ' + call + ' avec assez de texte'];
  }, { quota: 800, used: 0 }); // maxChars = max(600, 800*0.8*2.2=1408) = 1408
  session.setLanguageModel(lm);
  const r = await runner.runNano('sys', 'Titre', segs, { template: { prompt: 'Résume.' } });
  assert.ok(r.metrics.packs > 1, `packs=${r.metrics.packs}`);
  assert.ok(r.metrics.partials >= 1);
  assert.ok(r.text.includes('résultat') || r.text.includes('partie'));
});

test('runNano : warm-up en échec nomodel → NanoError nomodel', async () => {
  const lm = mockLMStream(['CPU backend stub here'], { quota: 8192 });
  session.setLanguageModel(lm);
  await assert.rejects(
    () => runner.runNano('sys', 'T', segs.slice(0, 5), { template: { prompt: 'x' } }),
    (e) => e.kind === 'nomodel'
  );
});

test('runNano : warm-up = contexte sérialisé seul + ping OK → ne bloque PAS', async () => {
  const lm = mockLMStream((call) => {
    if (call === 0) return ['probe'];
    if (call === 2 || call === 3) return ['User: foo End. Model: ']; // warm-up : rien généré
    return ['Réponse :\nrésultat final produit malgré le warm-up vide'];
  }, { quota: 8192 });
  lm.create = ((orig) => async function (o) {
    const s = await orig.call(this, o);
    s.prompt = async () => 'OK'; // ping A OK
    return s;
  })(lm.create.bind(lm));
  session.setLanguageModel(lm);
  const r = await runner.runNano('sys', 'T', segs, { template: { prompt: 'x' } });
  assert.ok(r.text.length > 0);
  assert.equal(r.metrics.warmup.ok, false);
});

test('runNano : warm-up vide mais ping OK → continue quand même (non bloquant)', async () => {
  const lm = mockLMStream((call) => {
    // nanoPing A (prompt non-streaming) → OK ; warm-up task → vide
    if (call === 0) return ['probe'];           // sonde quota
    if (call === 1) return ['OK'];               // ping (prompt() non-streaming mocké via promptStreaming)
    if (call === 2 || call === 3) return [''];   // warm-up task → vide
    return ['Réponse :\nrésultat final non vide produit par le fallback direct'];
  }, { quota: 8192 });
  // mock prompt() non-streaming pour le ping A
  lm.create = ((orig) => async function (o) {
    const s = await orig.call(this, o);
    s.prompt = async () => 'OK';
    return s;
  })(lm.create.bind(lm));
  session.setLanguageModel(lm);
  const r = await runner.runNano('sys', 'Titre', segs, { template: { prompt: 'Résume.' } });
  assert.ok(r.text.length > 0, 'texte vide malgré le fallback');
  assert.equal(r.metrics.warmup.ok, false);
});

test('runNano : ping KO (modèle ne génère rien) → NanoError nomodel avec diagnostic', async () => {
  const lm = mockLMStream(() => ['']); // tout vide
  lm.create = ((orig) => async function (o) {
    const s = await orig.call(this, o);
    s.prompt = async () => ''; // ping A aussi vide
    return s;
  })(lm.create.bind(lm));
  session.setLanguageModel(lm);
  await assert.rejects(
    () => runner.runNano('sys', 'T', segs, { template: { prompt: 'x' } }),
    (e) => e.kind === 'nomodel' && /chrome:\/\/on-device-internals/.test(e.message)
  );
});

test('probeContext : retourne maxChars depuis quota', async () => {
  const lm = mockLMStream([], { quota: 4096, used: 100 });
  session.setLanguageModel(lm);
  const mc = await runner.probeContext('sys');
  assert.equal(mc, Math.max(NANO_CFG.MIN_PACK_CHARS, Math.floor((4096 - 100) * 0.8 * 2.2)));
});

console.log('✓ tests-js/runner.test.js chargé');

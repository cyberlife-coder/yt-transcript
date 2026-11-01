// Constantes Gemini Nano — tout est ajustable ici, zéro magic number
// dans la logique métier.

export const NANO_CFG = {
  // Watchdog : un stream qui ne produit plus rien pendant ce délai est tué.
  STREAM_TIMEOUT_MS: 45_000,
  // Cap dur de caractères générés (un 3B peut boucler à l'infini).
  MAX_OUTPUT_CHARS: 6_000,
  // Throttle du rendu live : on ne re-rend le markdown que tous les N chunks.
  RENDER_THROTTLE: 8,
  // Taille de la queue de détection de boucle (anti-répétition).
  LOOP_TAIL: 200,
  // Sonde de contexte : marge de sécurité + densité car/token FR.
  CONTEXT_SAFETY: 0.8,
  CHARS_PER_TOKEN: 2.2,
  MIN_PACK_CHARS: 600,
  DEFAULT_QUOTA: 4096,
  // Map-reduce.
  WARMUP_SEGMENTS: 5,
  MAX_REPACK: 4,       // re-découpages bornés par partie
  MAX_FAILS: 8,        // au-delà, on abandonne le map-reduce
  // Retry du warm-up.
  WARMUP_RETRIES: 1,
  // Préfixe assistant qui force le point de continuation.
  ASSISTANT_PREFIX: 'Réponse :\n',
};

// Erreurs typées pour router les fallbacks proprement.
export class NanoError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'NanoError';
    this.kind = kind; // 'absent' | 'unavailable' | 'nomodel' | 'echo' | 'timeout' | 'loop' | 'quota'
  }
}

// Façade Gemini Nano — réexporte l'API publique depuis les modules nano/.
// Compatibilité : llm.js et admin.js importent depuis ici.
export { nanoApi, nanoStatus, setLanguageModel } from './nano/session.js';
export { runNano } from './nano/runner.js';
export { NanoError, NANO_CFG } from './nano/config.js';

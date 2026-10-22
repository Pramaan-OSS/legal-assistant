/** Browser tests may use only the local fake Pramaan server, never a live key. */
export const hasLlmKey = process.env.LOCAL_FAKE_PRAMAAN === '1';
export const LLM_SKIP_REASON = 'start the local fake Pramaan fixture and set LOCAL_FAKE_PRAMAAN=1';

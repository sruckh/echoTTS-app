export interface TTSVoice {
  id: string;
  label: string;
}

export const getConfig = () => {
  const env = window.__ENV__ || {};
  const importMetaEnv = import.meta.env;

  const endpoint = env.VITE_OPEN_AI_TTS_ENDPOINT || importMetaEnv.VITE_OPEN_AI_TTS_ENDPOINT || '';
  const model = env.VITE_OPEN_AI_TTS_MODEL || importMetaEnv.VITE_OPEN_AI_TTS_MODEL || 'gpt-4o-mini-tts';
  const voicesRaw = env.VITE_OPEN_AI_TTS_VOICES || importMetaEnv.VITE_OPEN_AI_TTS_VOICES;

  let voices: TTSVoice[] = [
    { id: 'alloy', label: 'Alloy' },
    { id: 'echo', label: 'Echo' },
    { id: 'fable', label: 'Fable' },
    { id: 'onyx', label: 'Onyx' },
    { id: 'nova', label: 'Nova' },
    { id: 'shimmer', label: 'Shimmer' }
  ];

  if (voicesRaw) {
    try {
      voices = JSON.parse(voicesRaw);
    } catch (e) {
      console.warn('Failed to parse VITE_OPEN_AI_TTS_VOICES', e);
    }
  }

  return {
    endpoint,
    model,
    voices
  };
};

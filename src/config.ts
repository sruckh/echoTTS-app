export interface TTSVoice {
  id: string;
  label: string;
}

export interface TTSService {
  id: string;
  label: string;
  endpoint: string;
  apiKey: string;
}

export const getConfig = () => {
  const env = window.__ENV__ || {};
  const importMetaEnv = import.meta.env;

  // Get shared configuration
  const model = env.VITE_TTS_MODEL || importMetaEnv.VITE_TTS_MODEL || 'tts-1';
  const voicesRaw = env.VITE_TTS_VOICES || importMetaEnv.VITE_TTS_VOICES;

  let voices: TTSVoice[] = [];

  if (voicesRaw) {
    try {
      voices = JSON.parse(voicesRaw);
    } catch (e) {
      console.warn('Failed to parse VITE_TTS_VOICES', e);
    }
  }

  // Get service configurations
  const services: TTSService[] = [];

  // EchoTTS
  const echottsEndpoint = env.VITE_ECHOTTS_ENDPOINT || importMetaEnv.VITE_ECHOTTS_ENDPOINT;
  const echottsApiKey = env.VITE_ECHOTTS_API_KEY || importMetaEnv.VITE_ECHOTTS_API_KEY;
  if (echottsEndpoint) {
    services.push({
      id: 'echotts',
      label: 'EchoTTS',
      endpoint: echottsEndpoint,
      apiKey: echottsApiKey || ''
    });
  }

  // Vibe Voice
  const vibevoiceEndpoint = env.VITE_VIBEVOICE_ENDPOINT || importMetaEnv.VITE_VIBEVOICE_ENDPOINT;
  const vibevoiceApiKey = env.VITE_VIBEVOICE_API_KEY || importMetaEnv.VITE_VIBEVOICE_API_KEY;
  if (vibevoiceEndpoint) {
    services.push({
      id: 'vibevoice',
      label: 'Vibe Voice',
      endpoint: vibevoiceEndpoint,
      apiKey: vibevoiceApiKey || ''
    });
  }

  // Chatterbox
  const chatterboxEndpoint = env.VITE_CHATTERBOX_ENDPOINT || importMetaEnv.VITE_CHATTERBOX_ENDPOINT;
  const chatterboxApiKey = env.VITE_CHATTERBOX_API_KEY || importMetaEnv.VITE_CHATTERBOX_API_KEY;
  if (chatterboxEndpoint) {
    services.push({
      id: 'chatterbox',
      label: 'Chatterbox',
      endpoint: chatterboxEndpoint,
      apiKey: chatterboxApiKey || ''
    });
  }

  // Fallback to legacy single endpoint for backward compatibility
  if (services.length === 0) {
    const legacyEndpoint = env.VITE_OPEN_AI_TTS_ENDPOINT || importMetaEnv.VITE_OPEN_AI_TTS_ENDPOINT;
    if (legacyEndpoint) {
      services.push({
        id: 'legacy',
        label: 'Default',
        endpoint: legacyEndpoint,
        apiKey: ''
      });
    }
  }

  return {
    model,
    voices,
    services
  };
};

export const getServiceById = (serviceId: string): TTSService | undefined => {
  const config = getConfig();
  return config.services.find(s => s.id === serviceId);
};

export const getDefaultService = (): TTSService | undefined => {
  const config = getConfig();
  return config.services[0];
};

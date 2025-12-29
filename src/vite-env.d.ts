/// <reference types="vite/client" />

interface Window {
  __ENV__: {
    VITE_OPEN_AI_TTS_ENDPOINT?: string;
    VITE_OPEN_AI_TTS_MODEL?: string;
    VITE_OPEN_AI_TTS_VOICES?: string; // JSON string
    VITE_TTS_MODEL?: string;
    VITE_TTS_VOICES?: string; // JSON string
    VITE_ECHOTTS_ENDPOINT?: string;
    VITE_ECHOTTS_API_KEY?: string;
    VITE_VIBEVOICE_ENDPOINT?: string;
    VITE_VIBEVOICE_API_KEY?: string;
    VITE_CHATTERBOX_ENDPOINT?: string;
    VITE_CHATTERBOX_API_KEY?: string;
    [key: string]: string | undefined;
  }
}

interface ImportMetaEnv {
  readonly VITE_OPEN_AI_TTS_ENDPOINT?: string;
  readonly VITE_OPEN_AI_TTS_MODEL?: string;
  readonly VITE_OPEN_AI_TTS_VOICES?: string;
  readonly VITE_TTS_MODEL?: string;
  readonly VITE_TTS_VOICES?: string;
  readonly VITE_ECHOTTS_ENDPOINT?: string;
  readonly VITE_ECHOTTS_API_KEY?: string;
  readonly VITE_VIBEVOICE_ENDPOINT?: string;
  readonly VITE_VIBEVOICE_API_KEY?: string;
  readonly VITE_CHATTERBOX_ENDPOINT?: string;
  readonly VITE_CHATTERBOX_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

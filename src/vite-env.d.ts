/// <reference types="vite/client" />

interface Window {
  __ENV__: {
    VITE_OPEN_AI_TTS_ENDPOINT?: string;
    VITE_OPEN_AI_TTS_MODEL?: string;
    VITE_OPEN_AI_TTS_VOICES?: string; // JSON string
    [key: string]: string | undefined;
  }
}

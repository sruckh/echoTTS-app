import { useState, useCallback } from 'react';
import { getConfig } from '../config';

interface GenerateTTSParams {
  text: string;
  voice: string;
}

/**
 * Custom hook for TTS generation
 * Handles API calls, loading states, and error handling
 */
export function useTTS() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = getConfig();

  const generate = useCallback(async ({ text, voice }: GenerateTTSParams): Promise<Blob | null> => {
    if (!text.trim()) {
      setError('Text cannot be empty');
      return null;
    }

    if (!config.endpoint) {
      setError('Configuration Error: No TTS Endpoint defined');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: text,
          voice: voice,
          format: 'opus',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      // Ensure correct MIME type
      const audioBlob = new Blob([blob], { type: 'audio/ogg; codecs=opus' });

      return audioBlob;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate audio';
      console.error('TTS generation error:', err);
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [config.endpoint, config.model]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    generate,
    clearError,
    config,
  };
}

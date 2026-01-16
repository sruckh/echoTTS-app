import { useState, useCallback } from 'react';
import { getConfig, getServiceById, TTSService } from '../config';

interface GenerateTTSParams {
  text: string;
  voice: string;
  serviceId?: string;
}

/**
 * Custom hook for TTS generation
 * Handles API calls, loading states, and error handling
 * Supports multiple TTS services with individual API keys
 */
export function useTTS() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = getConfig();

  const generate = useCallback(async ({ text, voice, serviceId }: GenerateTTSParams): Promise<Blob | null> => {
    if (!text.trim()) {
      setError('Text cannot be empty');
      return null;
    }

    // Get the service configuration
    let service: TTSService | undefined;
    
    if (serviceId) {
      service = getServiceById(serviceId);
    } else if (config.services.length > 0) {
      // Use first available service if none specified
      service = config.services[0];
    }

    if (!service) {
      setError('Configuration Error: No TTS service available');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Route through server-side proxy to avoid CORS issues
      // The proxy handles backend authentication and routing
      const requestBody = {
        service: service.id,
        text: text,
        voice: voice,
        model: config.model,
        stream: false,
        response_format: 'mp3'
      };

      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMsg = `Server returned ${response.status}: ${response.statusText}`;
        try {
          const errorBody = await response.text();
          if (errorBody) {
            errorMsg += ` - ${errorBody}`;
          }
        } catch (e) {
          // Ignore error parsing errors
        }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();

      // Use the actual content type from the response instead of overriding it
      const audioBlob = blob;

      return audioBlob;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate audio';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [config.model, config.services]);

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

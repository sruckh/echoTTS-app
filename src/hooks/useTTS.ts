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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Authorization header if API key is present
      if (service.apiKey) {
        headers['Authorization'] = `Bearer ${service.apiKey}`;
      }

      const requestBody = {
        model: config.model,
        input: text,
        voice: voice,
        response_format: 'mp3',
      };

      console.log(`[TTS Request] Service: ${service.id}, Voice: ${voice}, Model: ${config.model}, Format: mp3`);
      
      const response = await fetch(service.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      console.log(`[TTS Response] Service: ${service.id}, Content-Type: ${contentType}, Size: ${response.headers.get('content-length') || 'unknown'}`);

      const blob = await response.blob();
      console.log(`[TTS Blob] Service: ${service.id}, Blob Type: ${blob.type}, Size: ${blob.size}`);

      // Use the actual content type from the response instead of overriding it
      const audioBlob = blob;

      return audioBlob;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate audio';
      console.error('TTS generation error:', err);
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

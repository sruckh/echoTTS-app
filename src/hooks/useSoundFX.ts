import { useState, useCallback } from 'react';

export interface SoundFXResult {
  url: string;
  filename: string;
  metadata: {
    duration_seconds?: number;
    generation_time_seconds?: number;
  };
}

export interface SoundFXAdvancedParams {
  audio_temperature?: number;
  audio_top_p?: number;
  audio_top_k?: number;
  audio_repetition_penalty?: number;
}

export interface UseSoundFXReturn {
  loading: boolean;
  error: string | null;
  result: SoundFXResult | null;
  generate: (text: string, durationSeconds?: number, advanced?: SoundFXAdvancedParams) => Promise<SoundFXResult | null>;
  clearError: () => void;
  clearResult: () => void;
}

export function useSoundFX(): UseSoundFXReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SoundFXResult | null>(null);

  const generate = useCallback(
    async (text: string, durationSeconds?: number, advanced?: SoundFXAdvancedParams): Promise<SoundFXResult | null> => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const response = await fetch('/api/soundfx/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            duration_seconds: durationSeconds,
            ...advanced,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Sound effect generation failed' }));
          throw new Error(errorData.error || 'Sound effect generation failed');
        }

        const data: SoundFXResult = await response.json();
        setResult(data);
        return data;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Sound effect generation failed';
        console.error('[SoundFX] Error:', err);
        setError(errorMessage);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);
  const clearResult = useCallback(() => setResult(null), []);

  return { loading, error, result, generate, clearError, clearResult };
}

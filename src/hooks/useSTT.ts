import { useState, useCallback } from 'react';

export interface TranscriptionResult {
  text: string;
  timestamps?: {
    word?: Array<{ start: number; end: number; text: string }>;
    segment?: Array<{ start: number; end: number; segment: string }>;
  };
  success: boolean;
}

export interface PresignedUrlResponse {
  uuid: string;
  presignedUrl: string;
  key: string;
}

export interface UseSTTReturn {
  loading: boolean;
  error: string | null;
  getPresignedUrl: (filename: string, contentType: string) => Promise<PresignedUrlResponse>;
  transcribe: (uuid: string, includeTimestamps: boolean) => Promise<TranscriptionResult>;
  clearError: () => void;
}

export function useSTT(): UseSTTReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Get presigned URL for S3 upload
   */
  const getPresignedUrl = useCallback(
    async (filename: string, contentType: string): Promise<PresignedUrlResponse> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/stt/presign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename, contentType }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to generate upload URL' }));
          throw new Error(errorData.error || 'Failed to generate upload URL');
        }

        const data = await response.json();
        return data;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate upload URL';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Transcribe audio file
   */
  const transcribe = useCallback(
    async (uuid: string, includeTimestamps: boolean): Promise<TranscriptionResult> => {
      setLoading(true);
      setError(null);

      try {
        console.log(`[STT] Starting transcription for UUID: ${uuid}, timestamps: ${includeTimestamps}`);

        const response = await fetch('/api/stt/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uuid,
            timestamp: includeTimestamps,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Transcription failed' }));
          throw new Error(errorData.error || 'Transcription failed');
        }

        const result = await response.json();

        console.log(`[STT] Transcription complete:`, result);

        return {
          text: result.text || '',
          timestamps: result.timestamps,
          success: result.success !== false,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Transcription failed';
        console.error('[STT] Transcription error:', err);
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    getPresignedUrl,
    transcribe,
    clearError,
  };
}

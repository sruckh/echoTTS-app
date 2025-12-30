import { useState, useCallback } from 'react';

export interface AlibabaVoice {
  voice: string;
  gmt_create: string;
  target_model: string;
}

interface CreateVoiceParams {
  file: File;
  preferredName: string;
  targetModel: string;
}

interface UseAlibabaVoicesReturn {
  voices: AlibabaVoice[];
  loading: boolean;
  error: string | null;
  createVoice: (params: CreateVoiceParams) => Promise<string | null>;
  listVoices: () => Promise<void>;
  deleteVoice: (voiceId: string) => Promise<boolean>;
  clearError: () => void;
}

/**
 * Custom hook for Alibaba Cloud Qwen-TTS voice management
 * Handles voice creation, listing, and deletion via Express proxy routes
 */
export function useAlibabaVoices(): UseAlibabaVoicesReturn {
  const [voices, setVoices] = useState<AlibabaVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to convert file to Base64 data URI
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result); // Already includes data:audio/mpeg;base64,...
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  // Create a new voice from an audio file
  const createVoice = useCallback(async ({ file, preferredName, targetModel }: CreateVoiceParams): Promise<string | null> => {
    setLoading(true);
    setError(null);

    try {
      // Validate file format
      const validFormats = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a'];
      if (!validFormats.includes(file.type)) {
        throw new Error('Invalid file format. Please upload WAV, MP3, or M4A.');
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error('File size exceeds 10MB limit.');
      }

      // Convert to Base64 data URI
      const audioData = await fileToBase64(file);

      const response = await fetch('/api/alibaba/voice/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredName,
          audioData,
          targetModel
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      // Return the voice ID
      const voiceId = data.output?.voice;
      if (voiceId) {
        // Refresh the voice list after successful creation
        await listVoices();
        return voiceId;
      }

      throw new Error('Voice creation succeeded but no voice ID returned');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create voice';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [fileToBase64]);

  // List all voices for the account
  const listVoices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/alibaba/voice/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageSize: 100,
          pageIndex: 0
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      const voiceList = data.output?.voice_list || [];
      setVoices(voiceList);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to list voices';
      setError(errorMessage);
      setVoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete a voice
  const deleteVoice = useCallback(async (voiceId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/alibaba/voice/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      // Refresh the voice list after successful deletion
      await listVoices();
      return true;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete voice';
      setError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [listVoices]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    voices,
    loading,
    error,
    createVoice,
    listVoices,
    deleteVoice,
    clearError
  };
}

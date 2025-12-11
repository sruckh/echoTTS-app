import { useState, useRef, useCallback } from 'react';

/**
 * Custom hook for managing audio playback
 * Handles play/pause, error states, and cleanup
 */
export function useAudioPlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback((id: string, url: string) => {
    // If already playing this audio, pause it
    if (audioRef.current) {
      audioRef.current.pause();
      if (playingId === id) {
        setPlayingId(null);
        return;
      }
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(id);
    setError(null);

    audio.onended = () => setPlayingId(null);

    audio.onerror = () => {
      setError('Error during playback');
      setPlayingId(null);
    };

    audio.play().catch(e => {
      console.error('Play error:', e);
      setError('Autoplay blocked or failed');
      setPlayingId(null);
    });
  }, [playingId]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingId(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    playingId,
    error,
    play,
    pause,
    stop,
    clearError,
  };
}

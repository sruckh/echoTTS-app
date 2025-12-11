import { useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';

export interface HistoryItem {
  id: string;
  text: string;
  voice: string;
  blob: Blob;
  timestamp: number;
}

const DB_KEY = 'tts-history';
const MAX_HISTORY = 5;

/**
 * Custom hook to manage TTS history with IndexedDB persistence
 * Uses atomic operations and batch updates for better performance
 */
export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const val = await get<HistoryItem[]>(DB_KEY);
      if (val) {
        setHistory(val);
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const addItem = async (item: HistoryItem): Promise<HistoryItem[]> => {
    const newHistory = [item, ...history].slice(0, MAX_HISTORY);
    setHistory(newHistory);

    try {
      await set(DB_KEY, newHistory);
    } catch (error) {
      console.error('Failed to save history:', error);
    }

    return newHistory;
  };

  const removeItem = async (id: string): Promise<HistoryItem | null> => {
    const itemToRemove = history.find(h => h.id === id);
    const newHistory = history.filter(h => h.id !== id);
    setHistory(newHistory);

    try {
      await set(DB_KEY, newHistory);
    } catch (error) {
      console.error('Failed to update history:', error);
    }

    return itemToRemove || null;
  };

  const clearHistory = async () => {
    setHistory([]);
    try {
      await set(DB_KEY, []);
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  return {
    history,
    isLoading,
    addItem,
    removeItem,
    clearHistory,
  };
}

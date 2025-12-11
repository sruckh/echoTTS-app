import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook to manage object URLs lifecycle
 * Automatically creates and revokes URLs to prevent memory leaks
 */
export function useObjectUrls() {
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});

  // Sync ref with state for cleanup
  useEffect(() => {
    urlsRef.current = objectUrls;
  }, [objectUrls]);

  // Cleanup all URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  const createUrl = (id: string, blob: Blob): string => {
    // Check if we already have a URL for this ID to avoid duplicates
    if (objectUrls[id]) {
      return objectUrls[id];
    }
    
    const url = URL.createObjectURL(blob);
    setObjectUrls(prev => ({ ...prev, [id]: url }));
    return url;
  };

  const createUrls = (items: Array<{ id: string; blob: Blob }>): Record<string, string> => {
    const newUrls: Record<string, string> = {};
    let hasNew = false;

    items.forEach(item => {
      if (!objectUrls[item.id]) {
        newUrls[item.id] = URL.createObjectURL(item.blob);
        hasNew = true;
      }
    });

    if (hasNew) {
      setObjectUrls(prev => ({ ...prev, ...newUrls }));
      return { ...objectUrls, ...newUrls };
    }
    
    return objectUrls;
  };

  const revokeUrl = (id: string) => {
    setObjectUrls(prev => {
      const url = prev[id];
      if (url) {
        URL.revokeObjectURL(url);
        const newUrls = { ...prev };
        delete newUrls[id];
        return newUrls;
      }
      return prev;
    });
  };

  return {
    objectUrls,
    createUrl,
    createUrls,
    revokeUrl,
  };
}

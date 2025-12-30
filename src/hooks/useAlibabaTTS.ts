import { useState, useCallback, useRef } from 'react';
import { TTSService } from '../config';

interface GenerateAlibabaTTSParams {
  text: string;
  voice: string;
  service: TTSService;
}

interface UseAlibabaTTSReturn {
  loading: boolean;
  error: string | null;
  generate: (params: GenerateAlibabaTTSParams) => Promise<Blob | null>;
  clearError: () => void;
}

/**
 * Custom hook for Alibaba Cloud Qwen-TTS WebSocket-based generation
 * Uses WebSocket for real-time streaming audio synthesis
 */
export function useAlibabaTTS(): UseAlibabaTTSReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const generate = useCallback(async ({ text, voice, service }: GenerateAlibabaTTSParams): Promise<Blob | null> => {
    if (!text.trim()) {
      setError('Text cannot be empty');
      return null;
    }

    if (!service.endpoint || !service.apiKey) {
      setError('Alibaba service configuration missing');
      return null;
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve, reject) => {
      const audioChunks: Uint8Array[] = [];
      let sessionCreated = false;
      let inputSent = false;
      let finishPending = false;
      let updateWaitTimer: number | null = null;

      try {
        // Create WebSocket connection to our proxy (not directly to Alibaba)
        // Use the current host with the proxy path
        // Voice is set via session.update message, NOT URL parameter
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const proxyUrl = `${protocol}//${host}/api/alibaba/tts`;
        const ws = new WebSocket(proxyUrl);
        wsRef.current = ws;

        const sendInput = () => {
          if (inputSent) return;
          inputSent = true;
          sendEvent({
            type: 'input_text_buffer.append',
            text: text
          });
          sendEvent({
            type: 'input_text_buffer.commit'
          });
          finishPending = true;
        };

        // Connection timeout
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 30000);

        const sendEvent = (payload: Record<string, unknown>) => {
          const eventId = `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // CRITICAL: Match Python SDK's field order EXACTLY!
          // Python SDK sends: event_id, type, session (in this order)
          // JavaScript spread operator preserves order, so we must construct in correct order
          const fullPayload = {
            event_id: eventId,
            ...payload  // This will add type, session, etc. AFTER event_id
          };

          // CRITICAL: Match Python SDK's JSON format EXACTLY
          // Python json.dumps() adds spaces after colons and commas
          // JavaScript JSON.stringify() doesn't by default
          const jsonString = JSON.stringify(fullPayload)
            .replace(/,"/g, ', "')      // Add space after comma before quote
            .replace(/":/g, '": ')       // Add space after colon
            .replace(/,\{/g, ', {')      // Add space after comma before brace
            .replace(/,\[/g, ', [');     // Add space after comma before bracket

          ws.send(jsonString);
        };

        ws.onopen = () => {
          clearTimeout(timeout);

          // DO NOT send session.update here!
          // We must wait for session.created first, then send session.update
          // The session.update will be sent in the session.created handler below
        };

        ws.onmessage = (event) => {
          // Handle both text (JSON) and binary (Blob) messages
          if (typeof event.data === 'string') {
            try {
              const data = JSON.parse(event.data);

              switch (data.type) {
                case 'session.created':
                  sessionCreated = true;

                  // Send session.update with EXACT format from Python SDK
                  // Captured via DEBUG logging - this is the proven format!
                  const voiceToUse = voice;
                  const sessionConfig: Record<string, unknown> = {
                    voice: voiceToUse,
                    mode: 'server_commit',
                    response_format: 'pcm',
                    sample_rate: 24000
                  };

                  sendEvent({
                    type: 'session.update',
                    session: sessionConfig
                  });

                  // Wait for session.updated confirmation
                  updateWaitTimer = window.setTimeout(() => {
                    if (!inputSent) {
                      console.warn('[Alibaba TTS] No session.updated received, sending input anyway');
                      sendInput();
                    }
                  }, 500);
                  break;

                case 'session.updated':
                  if (updateWaitTimer) {
                    window.clearTimeout(updateWaitTimer);
                    updateWaitTimer = null;
                  }
                  if (!inputSent) {
                    sendInput();
                  }
                  break;

                case 'response.audio.delta':
                  // Collect audio chunk (base64 encoded)
                  if (data.delta) {
                    const binaryString = atob(data.delta);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    audioChunks.push(bytes);
                  }
                  break;

                case 'response.done':
                  if (finishPending) {
                    finishPending = false;
                    sendEvent({
                      type: 'session.finish'
                    });
                  }
                  break;

                case 'session.finished':
                  // All audio received, create blob and close
                  if (audioChunks.length > 0) {
                    // Combine all chunks into a single blob
                    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    const combinedArray = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of audioChunks) {
                      combinedArray.set(chunk, offset);
                      offset += chunk.length;
                    }

                    // Create WAV blob (PCM 24kHz mono 16-bit)
                    const blob = createWavBlob(combinedArray, 24000);
                    resolve(blob);
                  } else {
                    reject(new Error('No audio data received'));
                  }
                  ws.close();
                  break;

                case 'error':
                  console.error('[Alibaba TTS] Error received:', data.error?.message || 'WebSocket error');
                  reject(new Error(data.error?.message || 'WebSocket error'));
                  ws.close();
                  break;
              }
            } catch (err) {
              console.error('[Alibaba TTS] JSON parse error:', err);
            }
          } else if (event.data instanceof Blob) {
            // Binary data - handle audio chunk
            console.log('[Alibaba TTS] Received binary Blob, converting to ArrayBuffer...');
            const reader = new FileReader();
            reader.onload = () => {
              const arrayBuffer = reader.result as ArrayBuffer;
              const bytes = new Uint8Array(arrayBuffer);
              audioChunks.push(bytes);
            };
            reader.onerror = () => {
              console.error('[Alibaba TTS] Failed to read Blob data');
            };
            reader.readAsArrayBuffer(event.data);
          } else {
            console.log('[Alibaba TTS] Received unknown data type:', typeof event.data);
          }
        };

        ws.onerror = (event) => {
          clearTimeout(timeout);
          console.error('[Alibaba TTS] WebSocket error:', event);
          reject(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (updateWaitTimer) {
            window.clearTimeout(updateWaitTimer);
            updateWaitTimer = null;
          }

          if (!sessionCreated && audioChunks.length === 0) {
            reject(new Error('Connection closed without receiving audio'));
          }

          setLoading(false);
          wsRef.current = null;
        };

      } catch (err) {
        setLoading(false);
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate audio';
        setError(errorMessage);
        reject(new Error(errorMessage));
      }
    });
  }, []);

  // Helper to create WAV blob from PCM data
  const createWavBlob = (pcmData: Uint8Array, sampleRate: number): Blob => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    new Uint8Array(buffer, 44).set(pcmData);

    return new Blob([buffer], { type: 'audio/wav' });
  };

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useState(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  });

  return {
    loading,
    error,
    generate,
    clearError
  };
}

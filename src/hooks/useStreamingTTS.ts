import { useState, useRef } from 'react';
import { getServiceById } from '../config';

/**
 * useStreamingTTS Hook
 *
 * Supports MP3 streaming via MSE and EchoTTS PCM streaming via WebAudio.
 */

interface StreamingTTSOptions {
  text: string;
  voice: string;
  serviceId: string;
  onChunk?: (audioChunk: AudioBuffer, chunkNumber: number) => void;
  onComplete?: (totalDuration: number) => void;
  onError?: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

interface StreamingTTSState {
  isStreaming: boolean;
  progress: number;
  chunksReceived: number;
  totalDuration: number;
}

export function useStreamingTTS() {
  const [state, setState] = useState<StreamingTTSState>({
    isStreaming: false,
    progress: 0,
    chunksReceived: 0,
    totalDuration: 0
  });

  const stopRef = useRef<(() => void) | null>(null);

  const stop = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false }));
  };

  const generateStreaming = async (options: StreamingTTSOptions): Promise<void> => {
    const { text, voice, serviceId, onComplete, onError, onProgress } = options;

    stop();
    setState(prev => ({ ...prev, isStreaming: true, progress: 0, chunksReceived: 0 }));

    try {
      const service = getServiceById(serviceId);
      if (!service) throw new Error(`Service not found: ${serviceId}`);

      // 1. Prepare the request
      const payload = {
        service: serviceId,
        text,
        voice,
        stream: true,
        response_format: 'mp3'
      };

      const response = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`TTS Error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) throw new Error('No response body received');

      // Choose player based on service
      if (serviceId === 'echotts' || serviceId === 'default' || serviceId === 'indextts2') {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('audio/')) {
          await playBlobFallback(response.body, contentType, setState, stopRef, onProgress, onComplete);
        } else {
          await playEchoTtsPcmStream(response.body, setState, stopRef, onProgress, onComplete);
        }
      } else {
        await playMp3Stream(response.body, setState, stopRef, onProgress, onComplete);
      }

    } catch (error) {
      setState(prev => ({ ...prev, isStreaming: false }));
      onError?.(error as Error);
    }
  };

  return { generateStreaming, stop, ...state };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    f32[i] = Math.max(-1, int16[i] / 32768);
  }
  return f32;
}

async function playEchoTtsPcmStream(
  readableStream: ReadableStream<Uint8Array>,
  setState: React.Dispatch<React.SetStateAction<StreamingTTSState>>,
  stopRef: React.MutableRefObject<(() => void) | null>,
  onProgress?: (progress: number) => void,
  onComplete?: (duration: number) => void
) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let audioCtx: AudioContext | null = null;
  let nextStartTime = 0;
  let totalSamples = 0;
  let baseSampleRate: number | null = null;
  let finished = false;
  let finishTimeout: number | null = null;
  const sources: AudioBufferSourceNode[] = [];

  const cleanup = () => {
    if (finishTimeout !== null) {
      window.clearTimeout(finishTimeout);
      finishTimeout = null;
    }
    sources.forEach(source => {
      try {
        source.stop();
      } catch (_e) {}
      source.disconnect();
    });
    sources.length = 0;
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  };

  stopRef.current = cleanup;

  const schedulePcmChunk = (pcmBytes: Uint8Array, sampleRate: number) => {
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate });
      nextStartTime = audioCtx.currentTime + 0.05;
      baseSampleRate = sampleRate;
    }

    const int16 = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      Math.floor(pcmBytes.byteLength / 2)
    );
    const f32 = int16ToFloat32(int16);
    const audioBuffer = audioCtx.createBuffer(1, f32.length, sampleRate);
    // Ensure we pass a Float32Array backed by a plain ArrayBuffer for TS/DOM typings.
    audioBuffer.copyToChannel(new Float32Array(f32), 0);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const startAt = Math.max(audioCtx.currentTime + 0.01, nextStartTime);
    source.start(startAt);
    nextStartTime = startAt + audioBuffer.duration;
    totalSamples += f32.length;
    sources.push(source);
  };

  const finalize = () => {
    if (finished) return;
    finished = true;
    if (!audioCtx) {
      onComplete?.(0);
      setState(prev => ({ ...prev, isStreaming: false, progress: 100, totalDuration: 0 }));
      return;
    }
    const remainingMs = Math.max(0, (nextStartTime - audioCtx.currentTime) * 1000);
    const duration = baseSampleRate ? totalSamples / baseSampleRate : 0;
    finishTimeout = window.setTimeout(() => {
      onComplete?.(duration);
      setState(prev => ({
        ...prev,
        isStreaming: false,
        progress: 100,
        totalDuration: duration
      }));
    }, remainingMs);
  };

  const handleChunkObject = (chunk: any) => {
    if (!chunk) return;
    if (chunk?.status === 'complete') {
      finalize();
      return;
    }

    const audioBase64 = chunk?.audio_chunk;
    if (!audioBase64 || chunk?.format !== 'pcm_16') return;

    const sampleRate = Number(chunk?.sample_rate) || 44100;
    const pcmBytes = base64ToUint8Array(audioBase64);
    schedulePcmChunk(pcmBytes, sampleRate);

    onProgress?.(Math.min(95, Math.max(0, (chunk?.chunk || 0) * 2)));
    setState(prev => ({ ...prev, chunksReceived: prev.chunksReceived + 1 }));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf('\n');
      while (lineEnd !== -1) {
        const rawLine = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (rawLine.length === 0) {
          lineEnd = buffer.indexOf('\n');
          continue;
        }
        const line = rawLine.startsWith('data:') ? rawLine.slice(5).trim() : rawLine;
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed?.output)) {
            parsed.output.forEach(handleChunkObject);
          } else {
            handleChunkObject(parsed);
          }
        } catch (_e) {
          buffer = `${line}\n${buffer}`;
          break;
        }
        lineEnd = buffer.indexOf('\n');
      }
    }
  }

  const remaining = buffer.trim();
  if (remaining.length > 0) {
    try {
      const parsed = JSON.parse(remaining);
      if (Array.isArray(parsed?.output)) {
        parsed.output.forEach(handleChunkObject);
      } else {
        handleChunkObject(parsed);
      }
    } catch (_e) {}
  }

  finalize();
}

/**
 * Core MP3 Streaming Logic using MSE
 */
async function playMp3Stream(
  readableStream: ReadableStream<Uint8Array>,
  setState: React.Dispatch<React.SetStateAction<StreamingTTSState>>,
  stopRef: React.MutableRefObject<(() => void) | null>,
  onProgress?: (progress: number) => void,
  onComplete?: (duration: number) => void
) {
  const mimeType = 'audio/mpeg';

  // Fallback for browsers without MSE (e.g., some mobile iOS versions)
  // or if the specific MP3 codec isn't supported.
  if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
    console.warn('[Streaming] MSE not supported for MP3. Falling back to simple download-and-play.');
    await playBlobFallback(readableStream, mimeType, setState, stopRef, onProgress, onComplete);
    return;
  }

  const mediaSource = new MediaSource();
  const audio = new Audio();
  audio.src = URL.createObjectURL(mediaSource);
  
  // Cleanup function
  stopRef.current = () => {
    audio.pause();
    audio.src = '';
    stopRef.current = null;
    if (mediaSource.readyState === 'open') {
      try { mediaSource.endOfStream(); } catch (e) {}
    }
  };

  return new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', async () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        
        // BUFFER ACCUMULATOR CONFIG
        // Appending tiny chunks (< 1KB) to MSE is inefficient and causes stalls.
        // We accumulate ~4KB (or more) before pushing to the buffer.
        const CHUNK_THRESHOLD = 4096; 
        let bufferAccumulator: Uint8Array = new Uint8Array(0);
        
        let queue: Uint8Array[] = [];
        let isAppending = false;
        let totalReceived = 0;

        const reader = readableStream.getReader();

        // Queue Processor
        const processQueue = () => {
          if (isAppending || queue.length === 0 || !sourceBuffer || mediaSource.readyState !== 'open') return;

          isAppending = true;
          const chunk = queue.shift()!;

          try {
            sourceBuffer.appendBuffer(chunk as unknown as BufferSource);
          } catch (e) {
            isAppending = false;
          }
        };

        sourceBuffer.addEventListener('updateend', () => {
          isAppending = false;
          processQueue();

          // Start playback automatically when we have enough data
          if (audio.paused && sourceBuffer.buffered.length > 0 && audio.readyState >= 2) {
             audio.play().catch(() => {}); // Ignore autoplay errors
          }
        });

        // Network Reader Loop
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Push any remaining data in the accumulator
            if (bufferAccumulator.length > 0) {
              queue.push(bufferAccumulator);
              processQueue();
            }
            break;
          }

          if (value) {
            totalReceived += value.length;
            
            // Append new value to accumulator
            const newBuffer = new Uint8Array(bufferAccumulator.length + value.length);
            newBuffer.set(bufferAccumulator);
            newBuffer.set(value, bufferAccumulator.length);
            bufferAccumulator = newBuffer;

            // If we crossed the threshold, flush to queue
            if (bufferAccumulator.length >= CHUNK_THRESHOLD) {
              queue.push(bufferAccumulator);
              bufferAccumulator = new Uint8Array(0); // Reset
              processQueue();
            }

            // Update UI
            onProgress?.(Math.min(95, (totalReceived / 500000) * 100)); // Fake progress based on size
            setState(prev => ({ ...prev, chunksReceived: prev.chunksReceived + 1 }));
          }
        }

        // Stream complete
        const finishInterval = setInterval(() => {
          if (queue.length === 0 && !isAppending && mediaSource.readyState === 'open') {
             try {
               mediaSource.endOfStream();
             } catch(e) {}
             clearInterval(finishInterval);
          }
        }, 100);

      } catch (e) {
        reject(e);
      }
    });

    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      onComplete?.(audio.duration);
      setState(prev => ({ ...prev, isStreaming: false, progress: 100, totalDuration: audio.duration }));
      resolve();
    };

    audio.onerror = (_e) => {
      // Transient MSE errors are common and playback may still work
      // Don't reject - let onended handle completion if playback succeeds
    };
  });
}

/**
 * Fallback for non-MSE browsers or non-MP3 formats (downloads whole stream then plays)
 */
async function playBlobFallback(
  readableStream: ReadableStream<Uint8Array>,
  mimeType: string,
  setState: React.Dispatch<React.SetStateAction<StreamingTTSState>>,
  stopRef: React.MutableRefObject<(() => void) | null>,
  onProgress?: (progress: number) => void,
  onComplete?: (duration: number) => void
) {
  const reader = readableStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalReceived = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalReceived += value.length;
      onProgress?.(Math.min(95, (totalReceived / 500000) * 100));
      setState(prev => ({ ...prev, chunksReceived: prev.chunksReceived + 1 }));
    }
  }

  const blob = new Blob(chunks as any[], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  stopRef.current = () => {
    audio.pause();
    audio.src = '';
  };

  audio.onended = () => {
    URL.revokeObjectURL(url);
    onComplete?.(audio.duration);
    setState(prev => ({ ...prev, isStreaming: false, progress: 100, totalDuration: audio.duration }));
  };

  await audio.play();
}

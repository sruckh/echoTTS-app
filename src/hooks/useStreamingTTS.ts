import { useState } from 'react';
import { getServiceById } from '../config';

/**
 * useStreamingTTS Hook
 *
 * Handles streaming TTS requests via Server-Sent Events (SSE).
 * Receives audio chunks from Tier 2 (Middleware) and plays via Web Audio API.
 *
 * Note: No LinaCodec decoding happens here - all decoding is done by Tier 2.
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

  const generateStreaming = async (options: StreamingTTSOptions): Promise<void> => {
    const { text, voice, serviceId, onChunk, onComplete, onError, onProgress } = options;

    setState(prev => ({ ...prev, isStreaming: true, progress: 0, chunksReceived: 0 }));

    try {
      // Get service configuration from Tier 2 injected env vars
      const services = (window as any).__ENV__?.SERVICES || {};
      const service = services[serviceId] || getServiceById(serviceId);

      // If service not found in runtime config, check if it's a standard one we can construct
      // This is important for development or when runtime config isn't fully populated
      let streamEndpoint = '';
      let apiKey = '';
      
      if (service) {
        // Build streaming endpoint URL (Tier 2)
        // Use OpenAI endpoint with stream=true for raw PCM byte streaming
        if (service.streamingEndpoint) {
          streamEndpoint = service.streamingEndpoint;
        } else {
          // Use the standard OpenAI endpoint - stream param in payload enables streaming
          streamEndpoint = service.endpoint;
        }
        apiKey = service.apiKey;
      } else {
        // Fallback or explicit construction if needed.
        // If 'service' is missing, we try a relative path as a last resort
        // which works if the frontend and middleware are on the same domain/proxy
        if (serviceId === 'echotts' || serviceId === 'default') {
             streamEndpoint = '/v1/audio/speech';
        } else {
             throw new Error(`Service not found for streaming: ${serviceId}`);
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Transform payload to OpenAI format
      // Service expects: model, input, voice, response_format (optional)
      // Proxy (server.js) expects: service (for routing)
      const payload = {
        service: serviceId, // Required for proxy routing
        model: 'tts-1', // Default model, or get from config if available
        input: text,
        text: text,
        voice: voice,
        stream: true
      };

      const response = await fetch(streamEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Create audio context for playback (48kHz to match Tier 2 output)
      // We use a new context or reuse? creating new one per generation ensures clean state.
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass({ sampleRate: 48000 });
      const sources: AudioBufferSourceNode[] = [];
      let startTime = 0;
      let totalChunks = 0;
      let totalSamples = 0;

      // Read streaming response from Tier 2
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      // Buffer for accumulating partial data
      let buffer = new Uint8Array(0);
      const bytesPerSample = 2; // 16-bit PCM
      const samplesPerChunk = 4800; // 0.1 sec at 48kHz
      const minChunkSize = samplesPerChunk * bytesPerSample;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Accumulate data
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer, 0);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Try to decode complete chunks
        while (buffer.length >= minChunkSize) {
          try {
            // We process available data in multiples of bytesPerSample
            // Ideally we process 'samplesPerChunk' size, but we can also process whatever is ready
            // providing it's enough to be audible/useful.
            // Let's stick to processing whatever complete samples we have if it's > minChunkSize
            
            const availableSamples = Math.floor(buffer.length / bytesPerSample);
            const samplesToProcess = availableSamples; // Process all available complete samples
            
            const float32Array = new Float32Array(samplesToProcess);

            // Convert 16-bit PCM to Float32 for Web Audio API
            for (let i = 0; i < samplesToProcess; i++) {
              const byteIndex = i * 2;
              const sample = (buffer[byteIndex] | (buffer[byteIndex + 1] << 8));
              // Handle signed 16-bit integer
              const signedSample = sample >= 32768 ? sample - 65536 : sample;
              float32Array[i] = signedSample / 32768.0;
            }

            // Create audio buffer
            const audioBuffer = audioContext.createBuffer(1, samplesToProcess, 48000);
            audioBuffer.copyToChannel(float32Array, 0);

            // Schedule playback
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            if (startTime === 0) {
              // Start slightly in the future to allow scheduling? 
              // 0 means "as soon as possible"
              startTime = audioContext.currentTime + 0.1; // Small buffer
              source.start(startTime);
            } else {
              source.start(startTime);
            }
            
            // Advance start time for next chunk
            startTime += audioBuffer.duration;

            sources.push(source);
            totalChunks++;
            totalSamples += samplesToProcess;

            // Callbacks
            onChunk?.(audioBuffer, totalChunks);
            onProgress?.(Math.min(totalChunks * 5, 95)); // Rough progress

            // Update state
            setState(prev => ({
              ...prev,
              chunksReceived: totalChunks,
              progress: Math.min(totalChunks * 5, 95)
            }));

            // Remove processed data from buffer
            buffer = buffer.slice(samplesToProcess * bytesPerSample);

          } catch (decodeError) {
            // Not enough data or decode error, wait for more
            break;
          }
        }
      }

      // Calculate total duration based on when the last chunk ends
      // Note: audioContext.currentTime continues to run
      // Simplified: Just use the accumulated duration
      const calculatedDuration = totalSamples / 48000;

      setState(prev => ({
        ...prev,
        isStreaming: false,
        progress: 100,
        totalDuration: calculatedDuration
      }));

      onComplete?.(calculatedDuration);

    } catch (error) {
      setState(prev => ({ ...prev, isStreaming: false }));
      onError?.(error as Error);
    }
  };

  return {
    generateStreaming,
    ...state
  };
}

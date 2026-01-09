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
        // Use the OpenAI TTS endpoint with stream=true for raw PCM byte streaming
        // The worker's /v1/audio/speech endpoint handles streaming when stream=true
        // This returns raw audio bytes, not SSE
        streamEndpoint = service.endpoint;
        apiKey = service.apiKey;
      } else {
        // Fallback or explicit construction if needed
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

      // Transform payload to OpenAI TTS format
      // The /v1/audio/speech endpoint expects: model, input, voice, stream, response_format
      // Use response_format='pcm' to get raw PCM bytes instead of MP3
      const payload = {
        model: 'tts-1',
        input: text,
        voice: voice,
        stream: true,
        response_format: 'pcm'  // Request raw PCM output (not MP3)
      };

      const response = await fetch(streamEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMsg += ` - ${errorText}`;
          }
        } catch (e) {
          // Ignore error parsing errors
        }
        throw new Error(errorMsg);
      }

      // Create audio context for playback
      // Let the browser choose the sample rate - do NOT force 48kHz or 24kHz
      // The Web Audio API will handle sample rate conversion automatically
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
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
          console.log(`[Streaming] Stream ended. Remaining buffer: ${buffer.length} bytes`);
          break;
        }

        console.log(`[Streaming] Received ${value.length} bytes, buffer now ${buffer.length + value.length} bytes`);

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

            // Create audio buffer with the audio context's sample rate
            const audioBuffer = audioContext.createBuffer(1, samplesToProcess, audioContext.sampleRate);
            audioBuffer.copyToChannel(float32Array, 0);

            // Schedule playback
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            if (startTime === 0) {
              // Start slightly in the future to allow scheduling
              startTime = audioContext.currentTime + 0.1; // Small buffer
            }

            // Ensure schedule time is not in the past
            const scheduleTime = Math.max(startTime, audioContext.currentTime);
            source.start(scheduleTime);

            // Advance start time for next chunk
            startTime = scheduleTime + audioBuffer.duration;

            sources.push(source);
            totalChunks++;
            totalSamples += samplesToProcess;

            // Callbacks
            onChunk?.(audioBuffer, totalChunks);
            onProgress?.(Math.min(totalChunks * 5, 95)); // Rough progress

            console.log(`[Streaming] Processed and scheduled chunk ${totalChunks}: ${samplesToProcess} samples (${audioBuffer.duration.toFixed(2)}s)`);

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

      // Process any remaining buffer data (the final chunk)
      if (buffer.length >= bytesPerSample) {
        console.log(`[Streaming] Processing final buffer: ${buffer.length} bytes (${Math.floor(buffer.length / bytesPerSample)} samples)`);

        const remainingSamples = Math.floor(buffer.length / bytesPerSample);
        const float32Array = new Float32Array(remainingSamples);

        // Convert 16-bit PCM to Float32 for Web Audio API
        for (let i = 0; i < remainingSamples; i++) {
          const byteIndex = i * 2;
          const sample = (buffer[byteIndex] | (buffer[byteIndex + 1] << 8));
          const signedSample = sample >= 32768 ? sample - 65536 : sample;
          float32Array[i] = signedSample / 32768.0;
        }

        // Create and schedule final audio buffer
        const audioBuffer = audioContext.createBuffer(1, remainingSamples, audioContext.sampleRate);
        audioBuffer.copyToChannel(float32Array, 0);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        if (startTime === 0) {
          startTime = audioContext.currentTime + 0.1;
        }
        // Ensure schedule time is not in the past
        const scheduleTime = Math.max(startTime, audioContext.currentTime);
        source.start(scheduleTime);
        startTime = scheduleTime + audioBuffer.duration;

        sources.push(source);
        totalChunks++;
        totalSamples += remainingSamples;

        console.log(`[Streaming] Scheduled final chunk ${totalChunks}: ${remainingSamples} samples (${audioBuffer.duration.toFixed(2)}s) at ${scheduleTime.toFixed(2)}s`);

        onChunk?.(audioBuffer, totalChunks);
      } else {
        console.log(`[Streaming] No remaining buffer to process (${buffer.length} bytes)`);
      }

      // Calculate total duration based on when the last chunk ends
      // Use the audio context's sample rate for accurate duration calculation
      const calculatedDuration = totalSamples / audioContext.sampleRate;

      console.log(`[Streaming] Complete: ${totalChunks} chunks, ${totalSamples} samples, ${calculatedDuration.toFixed(2)}s at ${audioContext.sampleRate}Hz`);

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

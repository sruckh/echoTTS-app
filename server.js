import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { Readable } from 'stream';

/**
 * Create a WAV file header for PCM audio
 * @param {number} dataLength - Length of PCM data in bytes
 * @param {number} sampleRate - Sample rate in Hz (e.g., 48000)
 * @param {number} numChannels - Number of channels (1 for mono, 2 for stereo)
 * @param {number} bitsPerSample - Bits per sample (16 for pcm_16)
 * @returns {Buffer} WAV header buffer
 */
function createWavHeader(dataLength, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  
  const header = Buffer.alloc(44);
  
  // RIFF chunk descriptor
  header.write('RIFF', 0);                              // ChunkID
  header.writeUInt32LE(36 + dataLength, 4);             // ChunkSize
  header.write('WAVE', 8);                              // Format
  
  // fmt sub-chunk
  header.write('fmt ', 12);                             // Subchunk1ID
  header.writeUInt32LE(16, 16);                         // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);                          // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);                // NumChannels
  header.writeUInt32LE(sampleRate, 24);                 // SampleRate
  header.writeUInt32LE(byteRate, 28);                   // ByteRate
  header.writeUInt16LE(blockAlign, 32);                 // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34);              // BitsPerSample
  
  // data sub-chunk
  header.write('data', 36);                             // Subchunk2ID
  header.writeUInt32LE(dataLength, 40);                 // Subchunk2Size
  
  return header;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4173; // Standard Vite preview port, or whatever implementation.md said (it said 4173 or internal)

const DIST_DIR = path.join(__dirname, 'dist');

// Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Express middleware to parse JSON body
app.use(express.json({ limit: '10mb' }));

// Alibaba Cloud Qwen-TTS Proxy Routes
const ALIBABA_VOICE_API = process.env.VITE_ALIBABA_VOICE_API;
const ALIBABA_API_KEY = process.env.VITE_ALIBABA_API_KEY;
const ALIBABA_TTS_MODEL = process.env.VITE_ALIBABA_TTS_MODEL;

// Proxy: Create voice
app.post('/api/alibaba/voice/create', async (req, res) => {
  if (!ALIBABA_VOICE_API || !ALIBABA_API_KEY) {
    return res.status(500).json({ error: 'Alibaba configuration missing' });
  }

  try {
    const { preferredName, audioData, targetModel } = req.body;

    if (!preferredName || !audioData || !targetModel) {
      return res.status(400).json({ error: 'Missing required fields: preferredName, audioData, targetModel' });
    }

    const payload = {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: preferredName,
        audio: { data: audioData }
      }
    };

    console.log('[Alibaba Voice Create] Starting request for voice:', preferredName);
    const startTime = Date.now();

    const response = await fetch(ALIBABA_VOICE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ALIBABA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      // Increase timeout to 120 seconds for voice creation
      signal: AbortSignal.timeout(120000)
    });

    const data = await response.json();
    const duration = Date.now() - startTime;

    if (!response.ok) {
      console.error(`[Alibaba Voice Create] Error response (${duration}ms):`, JSON.stringify(data, null, 2));
      return res.status(response.status).json(data);
    }

    console.log(`[Alibaba Voice Create] Success (${duration}ms):`, data.output?.voice);
    res.json(data);
  } catch (error) {
    console.error('[Alibaba Voice Create] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy: List voices
app.post('/api/alibaba/voice/list', async (req, res) => {
  if (!ALIBABA_VOICE_API || !ALIBABA_API_KEY) {
    return res.status(500).json({ error: 'Alibaba configuration missing' });
  }

  try {
    const { pageSize = 100, pageIndex = 0 } = req.body;

    const payload = {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'list',
        page_size: pageSize,
        page_index: pageIndex
      }
    };

    const response = await fetch(ALIBABA_VOICE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ALIBABA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Alibaba list voices error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy: Delete voice
app.post('/api/alibaba/voice/delete', async (req, res) => {
  if (!ALIBABA_VOICE_API || !ALIBABA_API_KEY) {
    return res.status(500).json({ error: 'Alibaba configuration missing' });
  }

  try {
    const { voice } = req.body;

    if (!voice) {
      return res.status(400).json({ error: 'Missing required field: voice' });
    }

    const payload = {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'delete',
        voice: voice
      }
    };

    const response = await fetch(ALIBABA_VOICE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ALIBABA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Alibaba delete voice error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Streaming TTS Proxy
// ============================================================================
app.post('/api/tts/stream', async (req, res) => {
  try {
    const { service, text, voice, stream, input, model } = req.body;
    const resolvedText = input || text;
    
    // Determine the target endpoint based on service ID
    let targetEndpoint = '';
    let apiKey = '';
    let forceNoStream = false;

    // INTERNAL CONTAINER ROUTING: Use container names instead of localhost/public domains
    if (service === 'echotts' || service === 'default') {
      // EchoTTS RunPod Serverless (Direct)
      targetEndpoint = process.env.VITE_ECHOTTS_RUNPOD_ENDPOINT;
      apiKey = process.env.VITE_ECHOTTS_RUNPOD_API_KEY;
    } else if (service === 'vibevoice') {
      targetEndpoint = process.env.VITE_VIBEVOICE_ENDPOINT;
      apiKey = process.env.VITE_VIBEVOICE_API_KEY;
    } else if (service === 'chatterbox') {
      targetEndpoint = process.env.VITE_CHATTERBOX_ENDPOINT;
      apiKey = process.env.VITE_CHATTERBOX_API_KEY;
    } else if (service === 'qwen3-open') {
      targetEndpoint = process.env.VITE_QWEN3_TTS_ENDPOINT;
      apiKey = process.env.VITE_QWEN3_TTS_API_KEY;
    } else if (service === 'fishaudio') {
      targetEndpoint = process.env.VITE_FISHAUDIO_TTS_ENDPOINT;
      apiKey = process.env.VITE_FISHAUDIO_TTS_API_KEY;
    }

    if (!targetEndpoint) {
      console.error(`[Streaming Proxy] No endpoint found for service: ${service}`);
      return res.status(400).json({ error: `Service configuration missing for: ${service}` });
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const shouldStream = forceNoStream ? false : (stream !== undefined ? stream : true);
    const baseUrl = targetEndpoint.replace(/\/v1\/audio\/speech\/?$/, '');
    const streamEndpoint = `${baseUrl}/api/tts/stream`;

    // UNIFIED CONTRACT: All services return MP3 (audio/mpeg)
    let upstreamPayload;
    let upstreamUrl;

    if (service === 'echotts' || service === 'default') {
      // EchoTTS: RunPod Serverless direct
      // Documentation: https://github.com/sruckh/echo-tts
      const runpodEndpoint = process.env.VITE_ECHOTTS_RUNPOD_ENDPOINT || targetEndpoint;
      const runpodBase = runpodEndpoint.replace(/\/runsync\/?$/, '');
      upstreamUrl = `${runpodBase}/runsync`;
      
      // Build payload - output_format only needed for streaming (pcm_16 vs linacodec_tokens)
      // Batch mode without output_format returns OGG URL; streaming needs pcm_16 for browser playback
      upstreamPayload = {
        input: {
          text: resolvedText,
          speaker_voice: voice || undefined,
          stream: shouldStream,
          ...(shouldStream && { output_format: 'pcm_16' }),
          parameters: {
            num_steps: 40,
            cfg_scale_text: 3.0,
            cfg_scale_speaker: 8.0,
            seed: Date.now() % 1000000
          }
        }
      };

    } else if (service === 'chatterbox') {
      // Chatterbox: Always uses /v1/audio/speech, stream flag controls mode
      upstreamUrl = targetEndpoint;
      upstreamPayload = {
        model: model || 'tts-1',
        input: resolvedText,
        voice,
        stream: shouldStream,
        response_format: 'mp3'
      };
    } else if (service === 'qwen3-open') {
      const runpodEndpoint = process.env.VITE_QWEN3_TTS_ENDPOINT || targetEndpoint;
      const runpodBase = runpodEndpoint.replace(/\/runsync\/?$/, '');
      upstreamUrl = `${runpodBase}/runsync`;
      upstreamPayload = {
        input: {
          text: resolvedText,
          mode: 'voice_clone',
          voice,
          language: 'auto',
          stream: shouldStream,
          output_format: 'mp3'
        }
      };
    } else if (service === 'fishaudio') {
      // FishAudio S1-mini: RunPod Serverless direct (no input wrapper)
      const runpodEndpoint = process.env.VITE_FISHAUDIO_TTS_ENDPOINT || targetEndpoint;
      const runpodBase = runpodEndpoint.replace(/\/runsync\/?$/, '');
      upstreamUrl = `${runpodBase}/runsync`;
      // FishAudio expects direct parameters (NOT wrapped in input object)
      upstreamPayload = {
        input: {
          text: resolvedText,
          voice,
          stream: shouldStream,
          output_format: 'mp3'
        }
      };
    } else {
      // VibeVoice: Always uses /v1/audio/speech, stream flag controls mode
      upstreamUrl = targetEndpoint;
      upstreamPayload = {
        model: model || 'tts-1',
        input: resolvedText,
        voice,
        stream: shouldStream,
        response_format: 'mp3'
      };
    }

    console.log(`[Streaming Proxy] Forwarding to ${upstreamUrl} (format=mp3, stream=${shouldStream})`);

    // Increase fetch timeout to 5 minutes for streaming
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Streaming Proxy] Backend error (${response.status}) from ${upstreamUrl}`);
      return res.status(response.status).send(errorText);
    }

    // Handle streaming vs batch responses differently
    if (shouldStream) {
      // Streaming: Return raw audio bytes
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (service === 'qwen3-open') {
        res.setHeader('Content-Type', 'audio/mpeg');

        const data = await response.json();
        const outputChunks = Array.isArray(data?.output) ? data.output : [];

        for (const chunk of outputChunks) {
          const audioBase64 = chunk?.audio_chunk || chunk?.audio || chunk?.audio_base64;
          if (audioBase64) {
            res.write(Buffer.from(audioBase64, 'base64'));
          }
        }

        res.end();
        return;
      }

      if (service === 'fishaudio') {
        // FishAudio streaming: output is array with audio_chunk entries
        // Format: { output: [{ audio_chunk: "base64", chunk: 1, status: "streaming" }, { status: "complete" }] }
        const data = await response.json();
        console.log('[FishAudio Streaming] Raw response keys:', Object.keys(data), 'output length:', data?.output?.length);

        res.setHeader('Content-Type', 'audio/mpeg');
        const output = data?.output;

        if (Array.isArray(output)) {
          for (const chunk of output) {
            // Look for audio_chunk (streaming) or audio_base64 (batch)
            const audioBase64 = chunk?.audio_chunk || chunk?.audio_base64;
            if (audioBase64) {
              console.log(`[FishAudio] Writing chunk ${chunk?.chunk || 'N/A'}, size: ${audioBase64.length}`);
              res.write(Buffer.from(audioBase64, 'base64'));
            }
          }
        }

        // Also check for audio_url fallback (batch mode response)
        const firstOutput = Array.isArray(output) ? output[0] : output;
        const audioUrl = firstOutput?.audio_url || data?.audio_url;
        if (audioUrl) {
          console.log('[FishAudio] Fetching audio from URL:', audioUrl);
          try {
            const audioResponse = await fetch(audioUrl);
            if (audioResponse.ok && audioResponse.body) {
              // @ts-ignore
              const readable = Readable.fromWeb(audioResponse.body);
              readable.pipe(res);
              return;
            }
          } catch (err) {
            console.error('[FishAudio] Failed to fetch audio URL:', err.message);
          }
        }

        res.end();
        return;
      }

      if (service === 'echotts' || service === 'default') {
        // EchoTTS streaming: RunPod returns { output: [{ audio_chunk: "base64", format: "pcm_16", sample_rate: 48000 }, { status: "complete" }] }
        // Convert PCM to WAV so browsers can play it (similar to FishAudio pattern)
        const data = await response.json();
        const output = data?.output;
        
        if (Array.isArray(output)) {
          // Collect all audio chunks
          const audioChunks = [];
          let sampleRate = 48000;
          let isPCM = false;
          
          for (const chunk of output) {
            if (chunk?.format === 'pcm_16') {
              isPCM = true;
              sampleRate = chunk?.sample_rate || 48000;
            }
            const audioBase64 = chunk?.audio_chunk;
            if (audioBase64) {
              audioChunks.push(Buffer.from(audioBase64, 'base64'));
            }
          }
          
          if (audioChunks.length > 0) {
            // Concatenate all PCM data
            const pcmData = Buffer.concat(audioChunks);
            
            if (isPCM) {
              // Create WAV header for 16-bit PCM mono, then send as audio/wav
              // This matches FishAudio pattern: server converts to browser-playable format
              const wavHeader = createWavHeader(pcmData.length, sampleRate, 1, 16);
              const wavData = Buffer.concat([wavHeader, pcmData]);
              
              res.setHeader('Content-Type', 'audio/wav');
              res.setHeader('Content-Length', wavData.length.toString());
              res.send(wavData);
            } else {
              // Non-PCM, send as-is
              res.setHeader('Content-Type', 'audio/mpeg');
              res.send(pcmData);
            }
          } else {
            res.status(502).json({ error: 'EchoTTS response missing audio chunks' });
          }
        } else {
          res.status(502).json({ error: 'EchoTTS response missing output array' });
        }
        return;
      }

      const upstreamContentType = response.headers.get('content-type');
      res.setHeader('Content-Type', upstreamContentType || 'audio/mpeg');

      if (response.body) {
         // @ts-ignore
         const readable = Readable.fromWeb(response.body);

         return new Promise((resolve, reject) => {
           readable.pipe(res);

           readable.on('end', () => {
             console.log('[Streaming Proxy] Stream completed successfully');
             res.end();
             resolve();
           });

           readable.on('error', (err) => {
             console.error('[Streaming Proxy] Stream error:', err);
             reject(err);
           });
         });
      } else {
         res.end();
      }
    } else {
      // Batch: Return JSON with audio_url or audio_base64
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();

        if (service === 'qwen3-open') {
          if (data?.error) {
            return res.status(502).json(data);
          }

          const output = data?.output;
          const fetchAudioWithRetry = async (url) => {
            const maxAttempts = 4;
            let lastError;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              try {
                const audioResponse = await fetch(url);
                if (audioResponse.ok) {
                  return audioResponse;
                }
                lastError = new Error(`Audio fetch failed with status ${audioResponse.status}`);
              } catch (err) {
                lastError = err;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
            throw lastError;
          };

          if (Array.isArray(output)) {
            const firstChunk = output.find((item) => item?.audio_chunk || item?.audio || item?.audio_base64);
            const audioBase64 = firstChunk?.audio_chunk || firstChunk?.audio || firstChunk?.audio_base64;
            if (audioBase64) {
              const audioBuffer = Buffer.from(audioBase64, 'base64');
              res.setHeader('Content-Type', 'audio/mpeg');
              return res.send(audioBuffer);
            }

            const firstUrl = output.find((item) => item?.audio_url)?.audio_url;
            if (firstUrl) {
              const audioResponse = await fetchAudioWithRetry(firstUrl);
              const audioContentType = audioResponse.headers.get('content-type');
              res.setHeader('Content-Type', audioContentType || 'audio/mpeg');
              if (audioResponse.body) {
                // @ts-ignore
                const readable = Readable.fromWeb(audioResponse.body);
                return readable.pipe(res);
              }
              return res.end();
            }
          }

          if (output?.audio_url) {
            const audioResponse = await fetchAudioWithRetry(output.audio_url);
            if (!audioResponse.ok) {
              return res.status(502).json({ error: 'Failed to fetch RunPod audio URL' });
            }

            const audioContentType = audioResponse.headers.get('content-type');
            res.setHeader('Content-Type', audioContentType || 'audio/mpeg');
            if (audioResponse.body) {
              // @ts-ignore
              const readable = Readable.fromWeb(audioResponse.body);
              return readable.pipe(res);
            }
            return res.end();
          }

          if (output?.audio_base64) {
            const audioBuffer = Buffer.from(output.audio_base64, 'base64');
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.send(audioBuffer);
          }

          return res.status(502).json({ error: 'RunPod response missing audio payload' });
        }

        if (service === 'fishaudio') {
          // FishAudio batch: RunPod returns { output: [{ audio_url, status, ... }], status: "COMPLETED" }
          console.log('[FishAudio] Raw response:', JSON.stringify(data, null, 2));

          if (data?.error) {
            return res.status(502).json(data);
          }

          const fetchAudioWithRetry = async (url) => {
            const maxAttempts = 4;
            let lastError;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              try {
                console.log(`[FishAudio] Fetching audio URL attempt ${attempt}:`, url);
                const audioResponse = await fetch(url);
                if (audioResponse.ok) {
                  return audioResponse;
                }
                lastError = new Error(`Audio fetch failed with status ${audioResponse.status}`);
              } catch (err) {
                lastError = err;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
            throw lastError;
          };

          // RunPod wraps response: output is an ARRAY
          const output = data?.output;
          const firstOutput = Array.isArray(output) ? output[0] : output;

          // Check for audio_url in first output element
          const audioUrl = firstOutput?.audio_url || data?.audio_url;
          if (audioUrl) {
            console.log('[FishAudio] Found audio_url:', audioUrl);
            const audioResponse = await fetchAudioWithRetry(audioUrl);
            const audioContentType = audioResponse.headers.get('content-type');
            res.setHeader('Content-Type', audioContentType || 'audio/mpeg');
            if (audioResponse.body) {
              // @ts-ignore
              const readable = Readable.fromWeb(audioResponse.body);
              return readable.pipe(res);
            }
            return res.end();
          }

          // Check for audio_base64
          const audioBase64 = firstOutput?.audio_base64 || data?.audio_base64;
          if (audioBase64) {
            const audioBuffer = Buffer.from(audioBase64, 'base64');
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.send(audioBuffer);
          }

          return res.status(502).json({ error: 'FishAudio response missing audio payload', response: data });
        }

        if (service === 'echotts' || service === 'default') {
          // EchoTTS batch: RunPod returns { output: [{ url: "...", s3_key: "...", filename: "...", metadata: {...}, status: "completed" }], status: "COMPLETED" }
          // The URL is an S3 presigned URL to an OGG/Opus file
          if (data?.error) {
            return res.status(502).json(data);
          }

          const fetchAudioWithRetry = async (url) => {
            const maxAttempts = 4;
            let lastError;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              try {
                const audioResponse = await fetch(url);
                if (audioResponse.ok) {
                  return audioResponse;
                }
                lastError = new Error(`Audio fetch failed with status ${audioResponse.status}`);
              } catch (err) {
                lastError = err;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
            throw lastError;
          };

          const output = data?.output;
          const firstOutput = Array.isArray(output) ? output[0] : output;

          // EchoTTS batch returns 'url' (not 'audio_url') - S3 presigned URL to OGG file
          const audioUrl = firstOutput?.url || data?.url;
          if (audioUrl) {
            const audioResponse = await fetchAudioWithRetry(audioUrl);
            // OGG/Opus is natively supported by browsers
            const audioContentType = audioResponse.headers.get('content-type');
            res.setHeader('Content-Type', audioContentType || 'audio/ogg');
            if (audioResponse.body) {
              // @ts-ignore
              const readable = Readable.fromWeb(audioResponse.body);
              return readable.pipe(res);
            }
            return res.end();
          }

          return res.status(502).json({ error: 'EchoTTS response missing url', response: data });
        }

        console.log('[Streaming Proxy] Batch response:', { audio_url: !!data.audio_url, audio_base64: !!data.audio_base64 });
        res.json(data);
      } else {
        // Fallback: pipe non-JSON responses (e.g., direct audio)
        const upstreamContentType = response.headers.get('content-type');
        res.setHeader('Content-Type', upstreamContentType || 'audio/mpeg');

        if (response.body) {
           // @ts-ignore
           const readable = Readable.fromWeb(response.body);
           readable.pipe(res);
        } else {
           res.end();
        }
      }
    }

  } catch (error) {
    console.error('[Streaming Proxy] Fatal Error:', error);
    // Return detailed error info to the client for debugging
    res.status(500).json({ 
      error: 'Streaming proxy failed to reach backend container',
      details: error.message,
      code: error.code,
      cause: error.cause
    });
  }
});

// ============================================================================
// Voice Changing (Placeholder RunPod Serverless)
// ============================================================================
const VOICE_CHANGE_RUNPOD_ENDPOINT = process.env.VOICE_CHANGE_RUNPOD_ENDPOINT;
const VOICE_CHANGE_RUNPOD_API_KEY = process.env.VOICE_CHANGE_RUNPOD_API_KEY;
const S3_VC_BUCKET = process.env.S3_VC_BUCKET;
const S3_VC_REGION = process.env.S3_VC_REGION;
const S3_VC_ACCESS_KEY = process.env.S3_VC_ACCESS_KEY;
const S3_VC_SECRET_KEY = process.env.S3_VC_SECRET_KEY;
const S3_VC_ENDPOINT = process.env.S3_VC_ENDPOINT;

app.post('/api/voice-change/presign', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Missing filename or contentType' });
    }

    const allowedTypes = [
      'audio/m4a',
      'audio/mp3',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/opus',
      'audio/webm',
      'audio/x-m4a'
    ];

    if (!allowedTypes.includes(contentType.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    if (!S3_VC_BUCKET || !S3_VC_REGION || !S3_VC_ACCESS_KEY || !S3_VC_SECRET_KEY || !S3_VC_ENDPOINT) {
      console.error('[Voice Change Presign] Missing S3 configuration');
      return res.status(500).json({ error: 'Voice change storage not configured' });
    }

    const key = crypto.randomUUID();

    const s3Client = new S3Client({
      region: S3_VC_REGION,
      endpoint: S3_VC_ENDPOINT,
      credentials: {
        accessKeyId: S3_VC_ACCESS_KEY,
        secretAccessKey: S3_VC_SECRET_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: S3_VC_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return res.json({ key, presignedUrl });
  } catch (error) {
    console.error('[Voice Change Presign] Error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

app.post('/api/voice-change', async (req, res) => {
  try {
    if (!VOICE_CHANGE_RUNPOD_ENDPOINT || !VOICE_CHANGE_RUNPOD_API_KEY) {
      return res.status(501).json({ error: 'Voice change service not configured' });
    }

    const {
      source_audio_url,
      target_audio_url,
      source_audio_base64,
      target_audio_base64,
      source_key,
      target_key,
      output_format
    } = req.body || {};

    if (!source_audio_url && !source_audio_base64 && !source_key) {
      return res.status(400).json({ error: 'Missing source audio input' });
    }
    if (!target_audio_url && !target_audio_base64 && !target_key) {
      return res.status(400).json({ error: 'Missing target audio input' });
    }

    let resolvedSourceUrl = source_audio_url;
    let resolvedTargetUrl = target_audio_url;

    if ((source_key || target_key) && (!S3_VC_BUCKET || !S3_VC_REGION || !S3_VC_ACCESS_KEY || !S3_VC_SECRET_KEY || !S3_VC_ENDPOINT)) {
      return res.status(500).json({ error: 'Voice change storage not configured' });
    }

    if (source_key || target_key) {
      const s3Client = new S3Client({
        region: S3_VC_REGION,
        endpoint: S3_VC_ENDPOINT,
        credentials: {
          accessKeyId: S3_VC_ACCESS_KEY,
          secretAccessKey: S3_VC_SECRET_KEY,
        },
      });

      if (source_key) {
        const getCommand = new GetObjectCommand({ Bucket: S3_VC_BUCKET, Key: source_key });
        resolvedSourceUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      }

      if (target_key) {
        const getCommand = new GetObjectCommand({ Bucket: S3_VC_BUCKET, Key: target_key });
        resolvedTargetUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      }
    }

    const input = {
      audio_url_1: resolvedSourceUrl,
      audio_url_2: resolvedTargetUrl,
      format: output_format || 'mp3'
    };

    // Log presigned URLs for testing
    console.log('[Voice Change] Source URL:', resolvedSourceUrl);
    console.log('[Voice Change] Target URL:', resolvedTargetUrl);

    // RunPod endpoints need /runsync (synchronous) or /run (async) suffix
    const runpodUrl = VOICE_CHANGE_RUNPOD_ENDPOINT.replace(/\/?$/, '/runsync');

    const response = await fetch(runpodUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOICE_CHANGE_RUNPOD_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).send(errorText);
    }

    const data = await response.json();
    // Support both top-level audio_url and RunPod-style wrapped output.audio_url
    const output = data?.output || data;
    const audioUrl = output?.audio_url;

    if (!audioUrl) {
      return res.status(502).json({ error: 'Voice change response missing audio_url', details: data });
    }

    return res.json({ audio_url: audioUrl });
  } catch (error) {
    console.error('[Voice Change] Error:', error);
    return res.status(500).json({ error: 'Voice change request failed', details: error.message });
  }
});

// ============================================================================
// Speech-to-Text (STT) Endpoints
// ============================================================================

// STT Configuration
const S3_STT_BUCKET = process.env.S3_STT_BUCKET;
const S3_STT_REGION = process.env.S3_STT_REGION;
const S3_STT_ACCESS_KEY = process.env.S3_STT_ACCESS_KEY;
const S3_STT_SECRET_KEY = process.env.S3_STT_SECRET_KEY;
const S3_STT_ENDPOINT = process.env.S3_STT_ENDPOINT;
const RUNPOD_STT_ENDPOINT = process.env.RUNPOD_STT_ENDPOINT;
const RUNPOD_STT_API_KEY = process.env.RUNPOD_STT_API_KEY;
const STT_MAX_FILE_SIZE = parseInt(process.env.STT_MAX_FILE_SIZE || '104857600', 10); // 100MB default

// Generate presigned URL for S3 upload
app.post('/api/stt/presign', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Missing filename or contentType' });
    }

    // Validate content type
    const allowedTypes = [
      'audio/m4a',
      'audio/mp3',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/opus',
      'audio/webm',
      'audio/x-m4a'
    ];

    if (!allowedTypes.includes(contentType.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Check S3 configuration
    if (!S3_STT_BUCKET || !S3_STT_REGION || !S3_STT_ACCESS_KEY || !S3_STT_SECRET_KEY || !S3_STT_ENDPOINT) {
      console.error('[STT Presign] Missing S3 configuration');
      return res.status(500).json({ error: 'STT service not configured' });
    }

    // Generate UUID for filename (use as-is without extension)
    const uuid = crypto.randomUUID();
    const key = uuid;

    // Create S3 client
    const s3Client = new S3Client({
      region: S3_STT_REGION,
      endpoint: S3_STT_ENDPOINT,
      credentials: {
        accessKeyId: S3_STT_ACCESS_KEY,
        secretAccessKey: S3_STT_SECRET_KEY,
      },
    });

    // Create presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: S3_STT_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    console.log(`[STT Presign] Generated presigned URL for ${filename} (UUID: ${uuid})`);

    res.json({
      uuid,
      presignedUrl,
      key
    });

  } catch (error) {
    console.error('[STT Presign] Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Transcribe audio via RunPod Serverless
app.post('/api/stt/transcribe', async (req, res) => {
  try {
    const { uuid, timestamp } = req.body;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' });
    }

    // Check RunPod configuration
    if (!RUNPOD_STT_ENDPOINT || !RUNPOD_STT_API_KEY) {
      console.error('[STT Transcribe] Missing RunPod configuration');
      return res.status(500).json({ error: 'STT transcription service not configured' });
    }

    // Check S3 configuration
    if (!S3_STT_BUCKET || !S3_STT_REGION || !S3_STT_ACCESS_KEY || !S3_STT_SECRET_KEY || !S3_STT_ENDPOINT) {
      console.error('[STT Transcribe] Missing S3 configuration');
      return res.status(500).json({ error: 'STT service not configured' });
    }

    // Generate presigned GET URL for RunPod to download the file
    const s3Client = new S3Client({
      region: S3_STT_REGION,
      endpoint: S3_STT_ENDPOINT,
      credentials: {
        accessKeyId: S3_STT_ACCESS_KEY,
        secretAccessKey: S3_STT_SECRET_KEY,
      },
    });

    const getCommand = new GetObjectCommand({
      Bucket: S3_STT_BUCKET,
      Key: uuid,
    });

    // Generate presigned GET URL valid for 1 hour
    const s3Url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

    console.log(`[STT Transcribe] Starting transcription for UUID: ${uuid}`);
    const startTime = Date.now();

    // Call RunPod Serverless
    const response = await fetch(RUNPOD_STT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_STT_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          audio_url: s3Url,
          timestamp: timestamp || false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[STT Transcribe] RunPod error (${response.status}):`, errorText);
      return res.status(response.status).json({ error: 'Transcription failed' });
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    // RunPod wraps the actual transcription in an output object
    const output = result.output || result;

    // Check for success flag in response
    if (output.success === false) {
      console.error(`[STT Transcribe] Transcription failed (${duration}ms):`, output);
      return res.status(500).json({ error: 'Transcription failed', details: output });
    }

    console.log(`[STT Transcribe] Success (${duration}ms) for UUID: ${uuid}`);

    // Return just the output (contains text, timestamps, success)
    res.json(output);

  } catch (error) {
    console.error('[STT Transcribe] Error:', error);
    res.status(500).json({ error: 'Transcription service unavailable' });
  }
});

// Serve static assets (except index.html which we handle specifically for injection, 
// though typical static middleware might grab it first if we aren't careful.
// We can serve assets from dist/assets specifically, or just serve dist with index:false)
app.use(express.static(DIST_DIR, { index: false }));

// Helper to filter and get env vars
const getRuntimeEnv = () => {
  const env = {};
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('VITE_')) {
      env[key] = process.env[key];
    }
  });
  return env;
};

// Serve index.html for all other routes (SPA)
app.get('*', (_req, res) => {
  const indexFile = path.join(DIST_DIR, 'index.html');

  fs.readFile(indexFile, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading index.html:', err);
      return res.status(500).send('Server Error');
    }

    const envConfig = getRuntimeEnv();
    const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;

    // Replace the placeholder or just inject into head
    // Our index.html has <script id="env-config">window.__ENV__ = { ... };</script>
    // We can use a regex to replace the content of that script tag, or just the assignment.

    // Simple replacement of the assignment inside the known script ID context if possible,
    // or just a regex for window.__ENV__ = { ... };

    const result = data.replace(
      /window\.__ENV__\s*=\s*\{[\s\S]*?\};?/s, // Match multiline with non-greedy
      envScript
    );

    res.send(result);
  });
});

// Create HTTP server for Express
const server = createServer(app);

// Alibaba TTS WebSocket Proxy
const ALIBABA_TTS_WS = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';

const wss = new WebSocketServer({ server, path: '/api/alibaba/tts' });

wss.on('connection', (clientWs, _req) => {
  console.log('[Alibaba WS Proxy] Client connected');

  let alibabaWs = null;
  const messageBuffer = [];

  if (!ALIBABA_API_KEY) {
    console.error('[Alibaba WS Proxy] API key not configured');
    clientWs.send(JSON.stringify({ type: 'error', error: { message: 'Alibaba API key not configured' } }));
    clientWs.close();
    return;
  }

  try {
    console.log('[Alibaba WS Proxy] Connecting to Alibaba with API key...');

    // Build WebSocket URL with model parameter
    // Python SDK passes model to constructor, SDK adds it to URL internally
    // Without model, server defaults to qwen-omni-turbo (wrong model!)
    const wsUrl = ALIBABA_TTS_MODEL
      ? `${ALIBABA_TTS_WS}?model=${encodeURIComponent(ALIBABA_TTS_MODEL)}`
      : ALIBABA_TTS_WS;


    alibabaWs = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${ALIBABA_API_KEY}`
      }
    });

    alibabaWs.on('open', () => {
      console.log('[Alibaba WS Proxy] Connected to Alibaba');

      // Send any buffered messages
      if (messageBuffer.length > 0) {
        console.log(`[Alibaba WS Proxy] Sending ${messageBuffer.length} buffered messages`);
        messageBuffer.forEach(msg => {
          if (alibabaWs && alibabaWs.readyState === WebSocket.OPEN) {
            alibabaWs.send(msg);
          }
        });
        messageBuffer.length = 0;
      }
    });

    alibabaWs.on('message', (data, isBinary) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[Alibaba WS Proxy] Alibaba → Client:', message.type);

        if (message.type === 'error') {
          console.error('[Alibaba WS Proxy] Alibaba error:', JSON.stringify(message.error));
        }
      } catch (err) {
        // Binary data or non-JSON message
        if (isBinary) {
          console.log('[Alibaba WS Proxy] Alibaba → Client: [binary audio data]');
        }
      }

      // Forward messages from Alibaba to client
      if (clientWs.readyState === WebSocket.OPEN) {
        if (isBinary) {
          clientWs.send(data);
        } else {
          clientWs.send(data.toString());
        }
      }
    });

    alibabaWs.on('error', (error) => {
      console.error('[Alibaba WS Proxy] Alibaba WebSocket error:', error);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', error: { message: 'Alibaba WebSocket error' } }));
      }
      clientWs.close();
    });

    alibabaWs.on('close', (code, reason) => {
      const reasonText = reason ? reason.toString() : '';
      console.log(`[Alibaba WS Proxy] Alibaba connection closed: ${code} ${reasonText}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });

  } catch (error) {
    console.error('[Alibaba WS Proxy] Failed to connect to Alibaba:', error);
    clientWs.send(JSON.stringify({ type: 'error', error: { message: 'Failed to connect to Alibaba' } }));
    clientWs.close();
    return;
  }

  // Handle messages from client
  clientWs.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('[Alibaba WS Proxy] Client → Alibaba:', message.type);

      if (alibabaWs && alibabaWs.readyState === WebSocket.OPEN) {
        // Alibaba is ready, send directly
        // CRITICAL: Convert Buffer to string to ensure text frame (not binary)
        // Python SDK sends text frames, we must match exactly
        const dataString = typeof data === 'string' ? data : data.toString('utf8');
        alibabaWs.send(dataString);
      } else if (alibabaWs && alibabaWs.readyState === WebSocket.CONNECTING) {
        // Alibaba is still connecting, buffer the message
        console.log('[Alibaba WS Proxy] Buffering message (Alibaba connecting...)');
        messageBuffer.push(data);
      } else {
        // Alibaba connection failed or closed
        console.error('[Alibaba WS Proxy] Alibaba connection not available');
        clientWs.send(JSON.stringify({ type: 'error', error: { message: 'Alibaba connection failed' } }));
        clientWs.close();
      }
    } catch (err) {
      console.error('[Alibaba WS Proxy] Failed to parse client message:', err);
    }
  });

  clientWs.on('error', (error) => {
    console.error('[Alibaba WS Proxy] Client WebSocket error:', error);
  });

  clientWs.on('close', () => {
    console.log('[Alibaba WS Proxy] Client disconnected');
    if (alibabaWs && alibabaWs.readyState === WebSocket.OPEN || alibabaWs.readyState === WebSocket.CONNECTING) {
      alibabaWs.close();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

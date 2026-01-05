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

    // INTERNAL CONTAINER ROUTING: Use container names instead of localhost/public domains
    if (service === 'echotts' || service === 'default') {
      // Use the configured endpoint from environment (defaults to public URL if not overridden)
      // This allows flexibility: can be set to internal container (http://echotts-openai:8000...)
      // or public URL (https://echotts.gemneye.xyz...) in .env
      targetEndpoint = process.env.VITE_ECHOTTS_ENDPOINT || 'http://echotts-openai:8000/v1/audio/speech';
      apiKey = process.env.VITE_ECHOTTS_API_KEY;
    } else if (service === 'vibevoice') {
      targetEndpoint = process.env.VITE_VIBEVOICE_ENDPOINT;
      apiKey = process.env.VITE_VIBEVOICE_API_KEY;
    } else if (service === 'chatterbox') {
      targetEndpoint = process.env.VITE_CHATTERBOX_ENDPOINT;
      apiKey = process.env.VITE_CHATTERBOX_API_KEY;
    }

    if (!targetEndpoint) {
      console.error(`[Streaming Proxy] No endpoint found for service: ${service}`);
      return res.status(400).json({ error: `Service configuration missing for: ${service}` });
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const shouldStream = stream !== undefined ? stream : true;
    const baseUrl = targetEndpoint.replace(/\/v1\/audio\/speech\/?$/, '');
    const streamEndpoint = `${baseUrl}/api/tts/stream`;

    const upstreamPayload = shouldStream ? {
      service,
      text: resolvedText,
      voice,
      stream: true,
      response_format: 'pcm'
    } : {
      model: model || 'tts-1',
      input: resolvedText,
      voice,
      response_format: 'mp3',
      stream: false
    };

    const upstreamUrl = shouldStream ? streamEndpoint : targetEndpoint;
    console.log(`[Streaming Proxy] Forwarding to ${upstreamUrl} (stream=${shouldStream})`);

    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Streaming Proxy] Backend error (${response.status}):`, errorText);
      return res.status(response.status).send(errorText);
    }

    // Set headers
    res.setHeader('Cache-Control', 'no-cache');
    if (shouldStream) {
      res.setHeader('Content-Type', 'audio/pcm');
      res.setHeader('Connection', 'keep-alive');
    }

    // Node-fetch body is a stream
    if (response.body) {
       // @ts-ignore
       const readable = Readable.fromWeb(response.body);
       readable.pipe(res);
    } else {
       res.end();
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

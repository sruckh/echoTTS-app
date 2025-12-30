import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

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

# Echo TTS - Browser Client

A lightweight React + TypeScript application for interacting with an OpenAI-compatible Text-to-Speech endpoint.

## Features
- **Stream & Play:** Accumulates audio chunks and plays automatically upon completion.
- **History:** Keeps the last 5 generated audio clips in local storage (IndexedDB) for quick replay.
- **Download:** Easily download generated `.ogg` (Opus) files.
- **Dockerized:** Built for internal `shared_net` usage with Nginx Proxy Manager; no host ports exposed.
- **Runtime Config:** Change API endpoints and models via Docker environment variables without rebuilding the image.

## Quick Start (Docker)

1. **Network Setup:** Ensure the `shared_net` external network exists.
   ```bash
   docker network create shared_net
   ```

2. **Configure:** Edit `docker-compose.yml` to point to your TTS service.
   ```yaml
   environment:
     - VITE_OPEN_AI_TTS_ENDPOINT=http://your-tts-service:8000/v1/audio/speech
     - VITE_OPEN_AI_TTS_MODEL=gpt-4o-mini-tts
   ```

3. **Run:**
   ```bash
   docker-compose up -d --build
   ```

4. **Access:** Configure your Nginx Proxy Manager to forward traffic to the `echo-tts-ui` container on port `4173`.

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run dev server:
   ```bash
   npm run dev
   ```
   *Note: For local dev, create a `.env.local` file with `VITE_OPEN_AI_TTS_ENDPOINT=...`*

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_OPEN_AI_TTS_ENDPOINT` | URL to the TTS POST endpoint | (Required) |
| `VITE_OPEN_AI_TTS_MODEL` | Model ID to send in the JSON payload | `gpt-4o-mini-tts` |
| `VITE_OPEN_AI_TTS_VOICES` | JSON array of available voices | `[{"id":"alloy","label":"Alloy"},...]` |

## Architecture
- **Frontend:** Vite, React, MUI, TypeScript.
- **State:** In-memory + IndexedDB (via `idb-keyval`).
- **Server:** Custom Node.js/Express script (`server.js`) serving static files and injecting env vars at runtime into `index.html`.

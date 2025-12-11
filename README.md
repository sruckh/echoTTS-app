# Echo TTS - Browser Client

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2+-61DAFB.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)
[![Material-UI](https://img.shields.io/badge/MUI-5.14+-007FFF.svg)](https://mui.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> A lightweight, modern React + TypeScript application for interacting with OpenAI-compatible Text-to-Speech endpoints with audio history management.

Echo TTS provides a clean, intuitive interface for converting text to speech using any OpenAI-compatible TTS service. Features include streaming audio playback, persistent history storage, and seamless Docker deployment for production environments.

## ✨ Features

- **🎵 Stream & Play**: Accumulates audio chunks and plays automatically upon completion
- **📚 Persistent History**: Keeps the last 5 generated audio clips in IndexedDB for quick replay
- **💾 Download Support**: Export generated audio files as `.ogg` (Opus) format
- **🐳 Docker Ready**: Containerized for internal `shared_net` usage with Nginx Proxy Manager
- **⚙️ Runtime Configuration**: Change API endpoints and models via environment variables without rebuilding
- **🎨 Modern UI**: Clean Material-UI interface with dark theme support
- **🔄 Auto-play**: Generated audio plays automatically with fallback handling

## 🏗️ Architecture

![Architecture Diagram](./docs/diagrams/architecture.svg)

Echo TTS employs a dual-server architecture designed for both development flexibility and production stability:

### Production Mode
- **Express Server** (port 4173): Serves static files and injects runtime environment variables
- **Docker Container**: Runs on `shared_net` network without host port exposure
- **Nginx Proxy Manager**: Routes external traffic to the container

### Development Mode
- **Vite Dev Server** (port 5173): Hot module replacement and fast refresh
- **Local File System**: Direct serving of source files

### Data Flow
1. User input flows through React components to the TTS service
2. Audio responses are stored as blobs in IndexedDB
3. Object URLs are generated for playback and download
4. History is managed with automatic cleanup of old entries

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) and Docker Compose
- OpenAI-compatible TTS service

### Docker Deployment (Recommended)

1. **Create network** (if not exists):
   ```bash
   docker network create shared_net
   ```

2. **Configure the TTS endpoint**:
   Edit `docker-compose.yml` to point to your TTS service:
   ```yaml
   environment:
     - VITE_OPEN_AI_TTS_ENDPOINT=http://your-tts-service:8000/v1/audio/speech
     - VITE_OPEN_AI_TTS_MODEL=gpt-4o-mini-tts
   ```

3. **Deploy**:
   ```bash
   docker-compose up -d --build
   ```

4. **Configure Nginx Proxy Manager**:
   Forward traffic to `echo-tts-ui` container on port `4173`

### Local Development

1. **Clone and install**:
   ```bash
   git clone https://github.com/your-org/echo-tts-app.git
   cd echo-tts-app
   npm install
   ```

2. **Create environment file**:
   ```bash
   echo "VITE_OPEN_AI_TTS_ENDPOINT=http://localhost:8000/v1/audio/speech" > .env.local
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Access the application**:
   Open http://localhost:5173 in your browser

## 📖 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_OPEN_AI_TTS_ENDPOINT` | Full URL to the TTS POST endpoint | ✅ | - |
| `VITE_OPEN_AI_TTS_MODEL` | Model ID for TTS requests | ❌ | `gpt-4o-mini-tts` |
| `VITE_OPEN_AI_TTS_VOICES` | JSON array of available voices | ❌ | `[{"id":"alloy","label":"Alloy"},...]` |

### Voice Configuration Format

```json
[
  {"id": "alloy", "label": "Alloy"},
  {"id": "echo", "label": "Echo"},
  {"id": "fable", "label": "Fable"},
  {"id": "onyx", "label": "Onyx"},
  {"id": "nova", "label": "Nova"},
  {"id": "shimmer", "label": "Shimmer"}
]
```

### API Request Format

The application sends requests in this format:

```javascript
{
  model: "gpt-4o-mini-tts",
  input: "Your text here",
  voice: "alloy",
  format: "opus"
}
```

## 🛠️ Development Commands

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Start production server
npm start

# Type checking
npx tsc --noEmit
```

## 🧪 Testing the Integration

### Health Check
```bash
curl http://localhost:4173/health
```

### Direct TTS API Test
```bash
curl -X POST http://your-tts-service:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini-tts",
    "input": "Hello, world!",
    "voice": "alloy",
    "format": "opus"
  }' \
  --output test.ogg
```

## 📁 Project Structure

```
echoTTS-app/
├── src/                    # React application source
│   ├── App.tsx            # Main application component
│   ├── config.ts          # Configuration management
│   ├── main.tsx           # React app initialization
│   └── vite-env.d.ts      # Vite type definitions
├── docs/diagrams/         # Architecture diagrams
├── server.js              # Express server for production
├── index.html             # HTML template with env injection
├── docker-compose.yml     # Docker deployment configuration
├── Dockerfile             # Container build instructions
├── vite.config.ts         # Vite configuration
└── tsconfig.json          # TypeScript configuration
```

## 🔧 Technical Details

### State Management
- **React Hooks**: For component state and lifecycle
- **IndexedDB**: Persistent storage of audio history via `idb-keyval`
- **Object URLs**: Efficient audio playback without base64 encoding

### Audio Handling
- **Format**: Opus codec in OGG container
- **Storage**: Binary blobs in IndexedDB
- **Playback**: HTML5 Audio API with fallback error handling
- **Download**: Dynamic anchor element creation

### Environment Injection
The Express server injects runtime environment variables into `index.html`:
```javascript
window.__ENV__ = {
  VITE_OPEN_AI_TTS_ENDPOINT: "...",
  VITE_OPEN_AI_TTS_MODEL: "...",
  VITE_OPEN_AI_TTS_VOICES: "..."
};
```

## 🐳 Docker Configuration

### Build Context
- Multi-stage build for optimized production image
- Node.js 18 Alpine base image
- Nginx Proxy Manager compatible

### Network Configuration
- Uses external `shared_net` network
- No host ports exposed (internal-only)
- Health check endpoint at `/health`

### Environment Injection
Runtime environment variables are passed through Docker environment:
```yaml
environment:
  - VITE_OPEN_AI_TTS_ENDPOINT=${TTS_ENDPOINT}
  - VITE_OPEN_AI_TTS_MODEL=${TTS_MODEL}
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) for the TTS API specification
- [Material-UI](https://mui.com/) for the excellent React component library
- [Vite](https://vitejs.dev/) for the fast development tooling
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) for client-side persistence
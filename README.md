# Echo TTS - Browser Client

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2+-61DAFB.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)
[![Material-UI](https://img.shields.io/badge/MUI-5.14+-007FFF.svg)](https://mui.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> A modern React + TypeScript application for OpenAI-compatible Text-to-Speech with dynamic voice creation, user authentication, and audio history management.

Echo TTS provides a comprehensive platform for converting text to speech using any OpenAI-compatible TTS service. Features include dynamic voice creation with admin approval, user authentication via Supabase, persistent audio history storage, and seamless Docker deployment for production environments.

## ✨ Features

### Core TTS Functionality
- **🎵 Stream & Play**: Accumulates audio chunks and plays automatically upon completion
- **📚 Persistent History**: Keeps the last 5 generated audio clips in IndexedDB for quick replay
- **💾 Download Support**: Export generated audio files as `.ogg` (Opus) format
- **🔄 Auto-play**: Generated audio plays automatically with fallback handling

### Dynamic Voice Creation
- **🎤 Voice Recording**: Record audio directly from microphone or upload audio files (.wav, .ogg, .m4a, .mp3)
- **✏️ Custom Voices**: Create personal reference voices (30-60 seconds) with admin approval workflow
- **👥 User Roles**: Tiered access system (user → voice_creator → admin) via Supabase authentication
- **📊 Voice Management**: Dynamic voice listing replacing static configuration, real-time updates
- **🔒 Quota System**: Fair usage with 20 voice limit per user to prevent abuse

### Platform Features
- **🔐 Supabase Auth**: Secure user authentication with role-based access control
- **🗃️ Database-Backed**: PostgreSQL-backed voice metadata and request tracking
- **☁️ Cloud Storage**: S3-compatible storage for raw uploads and processed audio files
- **🔧 Runtime Configuration**: Change API endpoints and models via environment variables without rebuilding
- **🎨 Modern UI**: Clean Material-UI interface with light/dark theme toggle
- **🪝 Custom Hooks Architecture**: Modular, reusable React hooks for clean separation of concerns
- **♻️ Optimized Performance**: Built with React best practices and modern ES2022 features
- **🐳 Docker Ready**: Containerized for internal `shared_net` usage with Nginx Proxy Manager

## 🏗️ Architecture

![Architecture Diagram](./docs/diagrams/architecture.svg)

Echo TTS employs a comprehensive multi-service architecture with authentication, database storage, and dynamic voice management:

### Core Services
- **Frontend** (React/TypeScript): User interface with authentication and voice management
- **Express Server** (port 4173): Serves static files and injects runtime environment variables
- **TTS Bridge Service**: OpenAI-compatible API endpoint with voice management and Supabase integration
- **RunPod Serverless**: Audio processing and inference with shared volume access
- **Supabase**: Authentication, PostgreSQL database, and real-time subscriptions
- **S3 Storage**: Raw uploads and processed audio files with lifecycle management

### Deployment Architecture
- **Docker Container**: Runs on `shared_net` network without host port exposure
- **Nginx Proxy Manager**: Routes external traffic to the container
- **Production Mode**: Express server serves static files with runtime env injection
- **Development Mode**: Vite dev server (port 5173) with hot module replacement

### Authentication & Authorization Flow
1. User authenticates via Supabase (JWT tokens)
2. Roles: `user` (default) → `voice_creator_pending` → `voice_creator` → `admin`
3. Bridge service validates JWTs and enforces role-based access
4. Admin approval required for voice creation permissions

### Voice Creation Pipeline
1. **Upload**: Users upload/record 30-60s audio to S3 (uploads/ prefix)
2. **Registration**: Bridge registers voice in database with `pending` status
3. **Approval**: Admin reviews and approves requests via UI
4. **Processing**: Bridge normalizes audio to .ogg Opus format
5. **Deployment**: Processed files stored in S3 (processed/) and RunPod shared volume
6. **Availability**: Voice becomes available in TTS service

### Data Flow
1. User input flows through React components with authentication context
2. TTS requests go through bridge service with role validation
3. Audio responses stored as blobs in IndexedDB with automatic cleanup
4. Voice metadata managed in PostgreSQL with real-time updates
5. Audio files processed and stored in S3 with local caching

### Frontend Architecture
- **Authentication Context**: Supabase auth state management
- **Custom Hooks**: Modular logic for TTS, audio playback, history, URL lifecycle
- **Theme Context**: Dynamic light/dark mode switching with MUI theming
- **TypeScript**: Full type safety with ES2022 target
- **State Management**: React hooks with memoization and real-time updates

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) and Docker Compose
- OpenAI-compatible TTS service
- Supabase project (for authentication and database)
- S3-compatible storage service (for voice file storage)

### Docker Deployment (Recommended)

1. **Setup Supabase**:
   - Create a new Supabase project
   - Run `supabase/sql/001_schema.sql` in the Supabase SQL Editor
   - Create an admin user in the `user_roles` table
   - Get your Supabase URL and keys

2. **Create network** (if not exists):
   ```bash
   docker network create shared_net
   ```

3. **Configure environment**:
   Create a `.env` file with your configuration:
   ```bash
   # TTS Configuration
   TTS_ENDPOINT=http://your-tts-service:8000/v1/audio/speech
   TTS_MODEL=gpt-4o-mini-tts

   # Supabase Configuration
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-key

   # S3 Configuration (for voice storage)
   S3_BUCKET=your-bucket
   S3_REGION=us-east-1
   S3_ACCESS_KEY=your-access-key
   S3_SECRET=your-secret-key

   # Bridge API Configuration
   BRIDGE_API_URL=http://your-bridge-service:3000
   ```

4. **Deploy**:
   ```bash
   docker-compose up -d --build
   ```

5. **Configure Nginx Proxy Manager**:
   Forward traffic to `echo-tts-ui` container on port `4173`

6. **Access the application**:
   - Open your browser to the configured domain
   - Sign in with Supabase auth
   - Admin users can approve voice creation requests

### Local Development

1. **Clone and install**:
   ```bash
   git clone https://github.com/your-org/echo-tts-app.git
   cd echo-tts-app
   npm install
   ```

2. **Setup environment**:
   Create `.env.local` with your configuration:
   ```bash
   # TTS Configuration
   VITE_OPEN_AI_TTS_ENDPOINT=http://localhost:8000/v1/audio/speech
   VITE_OPEN_AI_TTS_MODEL=gpt-4o-mini-tts

   # Supabase Configuration
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key

   # Bridge API Configuration
   VITE_BRIDGE_API_URL=http://localhost:3000
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Access the application**:
   Open http://localhost:5173 in your browser

5. **Test voice creation**:
   - Sign in with Supabase auth
   - Request voice creation access (requires admin approval)
   - Upload or record a voice sample (30-60 seconds)

## 📖 Configuration

### Environment Variables

#### Core TTS Configuration
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_OPEN_AI_TTS_ENDPOINT` | Full URL to the TTS POST endpoint | ✅ | - |
| `VITE_OPEN_AI_TTS_MODEL` | Model ID for TTS requests | ❌ | `gpt-4o-mini-tts` |
| `VITE_OPEN_AI_TTS_VOICES` | JSON array of default voices (deprecated) | ❌ | `[{"id":"alloy","label":"Alloy"},...]` |

#### Supabase Authentication
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL | ✅ | - |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ | - |
| `SUPABASE_SERVICE_KEY` | Supabase service key (server-side) | ✅ | - |

#### Bridge API
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_BRIDGE_API_URL` | Bridge service base URL | ✅ | - |

#### S3 Storage
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `S3_BUCKET` | S3 bucket name | ✅ | - |
| `S3_REGION` | S3 bucket region | ✅ | - |
| `S3_ACCESS_KEY` | S3 access key | ✅ | - |
| `S3_SECRET` | S3 secret key | ✅ | - |
| `S3_REFERENCE_PREFIX` | Prefix for voice files | ❌ | `reference-voices/` |

#### Migration Note
The `VITE_OPEN_AI_TTS_VOICES` variable is deprecated. Voice configuration is now managed dynamically through the Supabase database and bridge API.

### Voice Creation Guidelines

When creating custom voices:

1. **Audio Requirements**:
   - Duration: 30-60 seconds
   - Formats: .wav, .ogg, .m4a, .mp3
   - Quality: Clear, consistent speech with minimal background noise
   - Content: Read a pangram for diverse phoneme coverage

2. **Recommended Pangram**:
   ```
   "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!"
   ```

3. **User Roles**:
   - `user`: Can use existing voices and TTS functionality
   - `voice_creator_pending`: Requested voice creation access
   - `voice_creator`: Can create and manage own voices
   - `admin`: Can approve requests and manage all voices

### API Request Format

The application sends OpenAI-compatible requests in this format:

```javascript
{
  model: "gpt-4o-mini-tts",
  input: "Your text here",
  voice: "alloy",
  response_format: "mp3"  // OpenAI API standard parameter
}
```

**Note**: The `response_format` parameter follows the OpenAI API specification. Each service may return audio in its native format (MP3, OGG, Opus) regardless of the requested format. The browser's Audio element handles all formats automatically via content-type headers.

### TTS Quality Considerations

When using RunPod-based TTS services (Vibe Voice, Chatterbox):

1. **Text Length Matters**:
   - ⚠️ **Short text (<100 characters)**: May produce inconsistent voice characteristics
   - ✅ **Optimal length (500+ characters)**: Best voice accuracy and consistency
   - This is inherent to the TTS model behavior, not a client-side limitation

2. **Chunking Long Text**:
   - Use the same seed value for all chunks to maintain voice consistency
   - Avoid very small chunk sizes (aim for 200+ characters per chunk)
   - Different chunks without seed control may exhibit slight voice variations

3. **Multi-Service Comparison**:
   - **EchoTTS**: Direct OpenAI endpoint, works well with any text length
   - **Vibe Voice/Chatterbox**: RunPod-based, optimized for longer text inputs

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
    "response_format": "mp3"
  }' \
  --output test.mp3
```

## 📁 Project Structure

```
echoTTS-app/
├── src/                    # React application source
│   ├── contexts/          # React contexts
│   │   ├── ThemeContext.tsx     # Theme management (light/dark mode)
│   │   └── AuthContext.tsx      # Supabase authentication state
│   ├── hooks/             # Custom React hooks
│   │   ├── index.ts            # Hook exports
│   │   ├── useAudioPlayer.ts   # Audio playback logic
│   │   ├── useHistory.ts       # History + IndexedDB management
│   │   ├── useObjectUrls.ts    # Blob URL lifecycle management
│   │   ├── useTTS.ts           # TTS API integration
│   │   ├── useAuth.ts          # Supabase auth integration
│   │   ├── useVoices.ts        # Dynamic voice management
│   │   └── useVoiceCreation.ts # Voice upload/creation flow
│   ├── components/        # Reusable UI components
│   │   ├── VoiceRecorder.tsx   # Microphone recording component
│   │   ├── VoiceUploader.tsx   # File upload component
│   │   ├── VoiceApproval.tsx   # Admin approval interface
│   │   └── VoiceManager.tsx    # Voice list and management
│   ├── App.tsx            # Main application component
│   ├── config.ts          # Configuration management
│   ├── supabaseClient.ts  # Supabase client initialization
│   ├── main.tsx           # React app initialization
│   └── vite-env.d.ts      # Vite type definitions
├── supabase/              # Database schema and migrations
│   └── sql/
│       └── 001_schema.sql  # Database schema for voices and auth
├── docs/                  # Documentation
│   ├── diagrams/          # Architecture diagrams
│   └── ADD_VOICE.md       # Voice creation feature specification
├── server.js              # Express server for production
├── index.html             # HTML template with env injection
├── docker-compose.yml     # Docker deployment configuration
├── Dockerfile             # Container build instructions
├── vite.config.ts         # Vite configuration
├── tsconfig.json          # TypeScript configuration (ES2022)
└── .env.example           # Example environment configuration
```

## 🔧 Technical Details

### State Management
- **Custom Hooks Architecture**: Modular, composable hooks following React best practices
  - `useTTS`: TTS API integration with loading and error states
  - `useAudioPlayer`: Audio playback management with cleanup
  - `useHistory`: IndexedDB persistence with atomic operations
  - `useObjectUrls`: Automatic blob URL lifecycle management
  - `useAuth`: Supabase authentication state management
  - `useVoices`: Dynamic voice listing with real-time updates
  - `useVoiceCreation`: Voice upload, recording, and submission workflow
- **React Contexts**:
  - `ThemeContext`: Light/dark mode theming with MUI
  - `AuthContext`: Supabase auth state and user role management
- **IndexedDB**: Persistent storage of audio history via `idb-keyval` v6+
- **Object URLs**: Efficient audio playback without base64 encoding
- **Real-time Updates**: Supabase real-time subscriptions for voice approval status

### Audio Handling
- **Format**: Opus codec in OGG container
- **Storage**: Binary blobs in IndexedDB with atomic operations
- **Playback**: HTML5 Audio API with fallback error handling
- **Download**: Dynamic anchor element creation
- **URL Management**: Automatic creation and cleanup to prevent memory leaks

### Voice Processing Pipeline
- **Upload Support**: .wav, .ogg, .m4a, .mp3 formats accepted
- **Duration Validation**: Client and server-side enforcement (30-60 seconds)
- **Audio Normalization**: FFmpeg conversion to standardized Opus format
- **File Storage**: S3 with prefixes (uploads/ for raw, processed/ for final)
- **Quality Assurance**: Admin approval workflow before voice activation

### Authentication & Security
- **JWT Validation**: Supabase JWT tokens validated on bridge service
- **Role-Based Access**: Database-enforced permissions per endpoint
- **Request Signing**: All API calls require valid authentication
- **File Security**: Presigned URLs with expiration for uploads
- **Input Validation**: Duration, format, and size validation on both client and server

### Modern React Patterns
- **Custom Hooks**: Separation of concerns with reusable logic
- **TypeScript**: Full type safety with ES2022 target
- **Memoization**: Optimized performance with `useMemo` and `useCallback`
- **Error Boundaries**: Proper error handling throughout the application
- **Clean Code**: Reduced component complexity (App.tsx: 286 → 198 lines)

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

## 🚧 Development Workflow

### Voice Creation Feature Development

The voice creation feature is documented in [`ADD_VOICE.md`](./ADD_VOICE.md). This comprehensive specification covers:

1. **Database Schema**: Supabase tables, triggers, and RLS policies
2. **API Endpoints**: Bridge service endpoints for voice management
3. **Frontend Components**: React components for recording, uploading, and approval
4. **Security**: Authentication, authorization, and input validation
5. **Migration**: Steps to upgrade from static to dynamic voices

### Setting Up Development Environment

1. **Database Setup**:
   ```bash
   # Run the schema in Supabase SQL Editor
   cat supabase/sql/001_schema.sql | pbcopy  # Copy to clipboard
   # Paste and execute in Supabase dashboard
   ```

2. **Environment Variables**:
   ```bash
   cp .env.example .env.local
   # Fill in your Supabase and S3 credentials
   ```

3. **Test Workflow**:
   - Start the bridge service separately (see ADD_VOICE.md)
   - Run `npm run dev` for the frontend
   - Test auth flow with different user roles
   - Verify voice creation and approval pipeline

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Voice Creation Feature Contributions

When contributing to the voice creation feature:
- Follow the specification in [`ADD_VOICE.md`](./ADD_VOICE.md)
- Test all user roles and permissions
- Verify audio processing and storage
- Ensure proper error handling and validation
- Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) for the TTS API specification
- [Material-UI](https://mui.com/) for the excellent React component library
- [Vite](https://vitejs.dev/) for the fast development tooling
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) for client-side persistence
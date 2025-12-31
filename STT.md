# Speech-to-Text (STT) Implementation Plan

## Overview

Add a Speech-to-Text feature to Echo: Multi-Model Voice Studio using RunPod Serverless with NVIDIA Parakeet for audio transcription.

### Key Features
- **Tab-based UI**: Mobile-friendly tabs for TTS and STT functionality
- **Audio Upload**: File picker and drag-and-drop support (.m4a, .mp3, .wav, .ogg, .opus)
- **Duration Limit**: Maximum 30 minutes per audio file
- **Timestamp Toggle**: Optional word/segment-level timestamps in output
- **Output Actions**: Copy to clipboard or download as .txt file
- **No Authentication**: Open access (rate limiting can be added later if needed)
- **No Persistence**: Transcriptions are session-only (no database storage)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React/TypeScript)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ TTS Tab     │  │ STT Tab     │  │ Theme Toggle│                 │
│  │ (existing)  │  │ (new)       │  │             │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│                           │                                          │
│                           ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ STT Component:                                              │    │
│  │  - File upload (click/drag-drop)                            │    │
│  │  - Duration validation (client + server)                    │    │
│  │  - Timestamp toggle                                         │    │
│  │  - Progress indicator                                       │    │
│  │  - Result display with copy/download buttons                │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Express Server (server.js:4173)                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ POST /api/stt/presign  - Generate S3 presigned PUT URL      │   │
│  │   - Validates file type/size                                │   │
│  │   - Returns UUID + presigned URL for upload                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ POST /api/stt/transcribe  - Proxy to RunPod Serverless      │   │
│  │   - Receives UUID from client                               │   │
│  │   - Constructs RunPod request with S3 URL                   │   │
│  │   - Forwards response to client                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   S3 Bucket  │  │   RunPod     │  │    Client    │
│  (Backblaze) │  │ Serverless   │  │   Browser    │
│              │  │  (Parakeet)  │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Environment Variables

### Required (Server-Side Only - NEVER exposed to client)

Add to `.env` and `.env.example`:

```bash
# S3 Configuration (Backblaze B2)
S3_STT_BUCKET=your-stt-bucket-name
S3_STT_REGION=us-east-1           # or your region
S3_STT_ACCESS_KEY=your-access-key
S3_STT_SECRET_KEY=your-secret-key
S3_STT_ENDPOINT=https://s3.us-east-004.backblazeb2.com  # Backblaze endpoint

# RunPod Serverless (Parakeet STT)
RUNPOD_STT_ENDPOINT=https://your-runpod-serverless-url
RUNPOD_STT_API_KEY=your-bearer-token

# Optional: File size limit (default 100MB)
STT_MAX_FILE_SIZE=104857600
```

### Important Security Notes

- **NEVER** add `S3_STT_SECRET_KEY` or `RUNPOD_STT_API_KEY` to `VITE_` prefixed variables
- These secrets must remain server-side only (injected via `server.js`)
- Client-side code receives only presigned URLs (which are temporary and scoped)

---

## Data Flow

### 1. Upload Flow

```
Client                          Express Server                    S3 (Backblaze)
  │                                  │                              │
  ├──1. POST /api/stt/presign────────▶                              │
  │    { filename, contentType }      │                              │
  │                                   │                              │
  │◀────2. { uuid, presignedUrl }─────┤                              │
  │                                   │                              │
  ├──3. PUT presignedUrl─────────────────────────────────────────────▶
  │    [Binary audio data]            │                              │
  │                                   │                              │
  │◀────4. 200 OK ───────────────────────────────────────────────────┤
  │                                   │                              │
```

### 2. Transcription Flow

```
Client                          Express Server                    RunPod Serverless
  │                                  │                                 │
  ├──1. POST /api/stt/transcribe─────▶                                 │
  │    { uuid, timestamp: true }     │                                 │
  │                                   │                                 │
  │                                   ├──2. Construct S3 URL─────────▶
  │                                   │   { audio_url, timestamp }     │
  │                                   │                                 │
  │                                   │◀──3. { text, timestamps... }───┤
  │                                   │                                 │
  │◀──4. Return transcription─────────┤                                 │
```

---

## Frontend Implementation

### File Structure

```
src/
├── components/
│   └── STTTab.tsx              # NEW: Main STT component
├── hooks/
│   ├── useSTT.ts               # NEW: STT state and API logic
│   └── useFileUpload.ts        # NEW: File upload, drag-drop, validation
├── App.tsx                     # MODIFIED: Add tabs, integrate STTTab
```

### Components to Create

#### 1. `src/components/STTTab.tsx`

Main component for the STT tab interface.

**Features:**
- File upload button (click to browse)
- Drag-and-drop zone with visual feedback
- File type validation (.m4a, .mp3, .wav, .ogg, .opus)
- Duration validation (max 30 minutes)
- Progress indicator during upload + transcription
- Timestamp toggle switch
- Result display area with:
  - Text content (read-only textarea or div)
  - Timestamp visualization (when enabled)
  - Copy to clipboard button
  - Download as .txt button
- Error display with retry option

**Props:** None (uses hooks internally)

**State:**
```typescript
interface STTTabState {
  // Upload state
  selectedFile: File | null;
  isUploading: boolean;
  uploadProgress: number;
  uploadedUuid: string | null;

  // Transcription state
  isTranscribing: boolean;
  transcription: {
    text: string;
    timestamps?: {
      word: Array<{ start: number; end: number; text: string }>;
      segment: Array<{ start: number; end: number; segment: string }>;
    };
  } | null;

  // Options
  includeTimestamps: boolean;

  // Errors
  error: string | null;
}
```

#### 2. `src/hooks/useSTT.ts`

Custom hook for STT API calls.

**Functions:**
```typescript
interface UseSTTReturn {
  // Presigned URL for upload
  getPresignedUrl: (filename: string, contentType: string) =>
    Promise<{ uuid: string; presignedUrl: string }>;

  // Transcribe uploaded file
  transcribe: (uuid: string, includeTimestamps: boolean) =>
    Promise<TranscriptionResult>;

  // Loading/error states
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

interface TranscriptionResult {
  text: string;
  timestamps?: {
    word: Array<{ start: number; end: number; text: string }>;
    segment: Array<{ start: number; end: number; segment: string }>;
  };
  success: boolean;
}
```

#### 3. `src/hooks/useFileUpload.ts`

Custom hook for file handling and S3 upload.

**Functions:**
```typescript
interface UseFileUploadReturn {
  // Validate file
  validateFile: (file: File) => { valid: boolean; error?: string };

  // Upload to S3 via presigned URL
  uploadToS3: (file: File, presignedUrl: string, onProgress?: (progress: number) => void) =>
    Promise<void>;

  // Calculate duration from audio file
  getDuration: (file: File) => Promise<number>; // in seconds
}
```

**Duration Validation:**
- Client-side: Parse audio metadata to get duration before upload
- Server-side: Verify duration in the transcribe endpoint (defensive)

### Modifications to Existing Files

#### `src/App.tsx` Changes

1. **Add MUI Tabs component:**
```typescript
import { Tabs, Tab, Box } from '@mui/material';

const [currentTab, setCurrentTab] = useState<'tts' | 'stt'>('tts');

const handleTabChange = (_: React.SyntheticEvent, newValue: 'tts' | 'stt') => {
  setCurrentTab(newValue);
};
```

2. **Wrap existing TTS content in conditional render:**
```typescript
{currentTab === 'tts' && (
  // Existing TTS Card and History sections
)}
```

3. **Add STT tab content:**
```typescript
{currentTab === 'stt' && (
  <STTTab />
)}
```

4. **Update header area to include tabs:**
```typescript
<Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
  <Tabs value={currentTab} onChange={handleTabChange}>
    <Tab label="Text to Speech" value="tts" />
    <Tab label="Speech to Text" value="stt" />
  </Tabs>
</Box>
```

---

## Backend Implementation

### `server.js` Modifications

The Express server (port 4173) needs two new endpoints:

#### 1. GET/POST `/api/stt/presign`

Generate a presigned S3 URL for the client to upload directly.

```javascript
// Generate presigned URL for S3 upload
app.post('/api/stt/presign', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    // Validate content type
    const allowedTypes = ['audio/m4a', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/opus', 'audio/x-m4a', 'audio/mpeg'];
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Generate UUID for filename (use as-is without extension)
    // RunPod can detect audio format from file content
    const uuid = crypto.randomUUID();
    const key = uuid;

    // Generate presigned URL using AWS SDK v3
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const s3Client = new S3Client({
      region: process.env.S3_STT_REGION,
      endpoint: process.env.S3_STT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_STT_ACCESS_KEY,
        secretAccessKey: process.env.S3_STT_SECRET_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: process.env.S3_STT_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({
      uuid,
      presignedUrl,
      key
    });

  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});
```

#### 2. POST `/api/stt/transcribe`

Proxy the transcription request to RunPod Serverless.

```javascript
// Transcribe audio via RunPod Serverless
app.post('/api/stt/transcribe', async (req, res) => {
  try {
    const { uuid, timestamp } = req.body;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' });
    }

    // Generate presigned GET URL for RunPod to download the file
    // This is required for private S3 buckets
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const s3Client = new S3Client({
      region: process.env.S3_STT_REGION,
      endpoint: process.env.S3_STT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_STT_ACCESS_KEY,
        secretAccessKey: process.env.S3_STT_SECRET_KEY,
      },
    });

    const getCommand = new GetObjectCommand({
      Bucket: process.env.S3_STT_BUCKET,
      Key: uuid,
    });

    // Generate presigned GET URL valid for 1 hour
    const s3Url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

    // Call RunPod Serverless
    const response = await fetch(process.env.RUNPOD_STT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RUNPOD_STT_API_KEY}`,
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
      console.error('RunPod error:', errorText);
      return res.status(response.status).json({ error: 'Transcription failed' });
    }

    const result = await response.json();

    // RunPod wraps the actual transcription in an output object
    const output = result.output || result;

    // Check for success flag in response
    if (output.success === false) {
      return res.status(500).json({ error: 'Transcription failed', details: output });
    }

    // Return just the output (contains text, timestamps, success)
    res.json(output);

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription service unavailable' });
  }
});
```

### Required Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0"
  }
}
```

---

## UI/UX Specifications

### STT Tab Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────┐  ┌─────────────┐                           │
│  │ Text to Sp.. │  │ Speech to.. │   <- Tabs                 │
│  └─────────────┘  └─────────────┘                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │    📁 Drop audio file here or click to upload       │   │
│  │                                                     │   │
│  │    Supported: .m4a, .mp3, .wav, .ogg, .opus        │   │
│  │    Max duration: 30 minutes                         │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ☐ Include timestamps in output                            │
│                                                             │
│  [Transcribe Audio]  <- Button                              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Transcription Result                                │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                     │   │
│  │ [Transcribed text appears here...]                  │   │
│  │                                                     │   │
│  │ [00:00 - 00:02] This is the transcribed text.      │   │ <- With timestamps
│  │                                                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  [📋 Copy]  [⬇️ Download .txt]                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Visual Feedback States

1. **Idle (No file selected):**
   - Upload zone visible with dashed border
   - Upload button disabled

2. **File Selected (Not uploaded):**
   - Show file name and duration
   - Upload button enabled

3. **Uploading:**
   - Progress bar with percentage
   - "Uploading to S3..." message

4. **Transcribing:**
   - Spinner animation
   - "Transcribing audio..." message

5. **Complete:**
   - Show transcription text
   - Enable copy/download buttons
   - If timestamps enabled, show formatted timestamps

### Timestamp Display Format

When `includeTimestamps` is true, format the output as:

```
[00:00.0 - 00:02.5] This is the first segment.
[00:02.5 - 00:05.0] This is the second segment.
```

Word-level timestamps can be shown in a tooltip or expandable section.

---

## Error Handling

### Client-Side Errors

| Error | Display Message | Action |
|-------|-----------------|--------|
| Invalid file type | "Please upload an audio file (.m4a, .mp3, .wav, .ogg, .opus)" | Show in toast |
| File too large | "File exceeds maximum size of 100MB" | Show in toast |
| Duration exceeded | "Audio exceeds 30-minute limit. Please use a shorter file." | Show in toast |
| Upload failed | "Upload failed. Please try again." | Show error, enable retry |
| Transcription failed | "Transcription failed. Please try again." | Show error, enable retry |
| Network error | "Network error. Please check your connection." | Show error |

### Server-Side Errors

| Error | HTTP Status | Client Message |
|-------|-------------|----------------|
| Missing filename/contentType | 400 | "Invalid request" |
| Invalid file type | 400 | "Invalid file type" |
| S3 presign failed | 500 | "Upload service unavailable" |
| Missing UUID | 400 | "Invalid request" |
| RunPod error | 502 | "Transcription service unavailable" |
| RunPod timeout | 504 | "Transcription timed out. Try a shorter file." |

---

## File Size Calculations

### Max Duration: 30 minutes

At typical audio bitrates:
- MP3 (128 kbps): ~30MB per 30-minute file
- WAV (uncompressed): ~300MB per 30-minute file
- Opus (64 kbps): ~15MB per 30-minute file

**Recommended max file size: 100MB** (configurable via `STT_MAX_FILE_SIZE`)

---

## Testing Checklist

### Manual Testing

- [ ] File picker opens correct file types (.m4a, .mp3, .wav, .ogg, .opus)
- [ ] Drag and drop works with visual feedback
- [ ] Non-audio files are rejected with clear error
- [ ] Files over 100MB are rejected
- [ ] Duration validation works for files < 30 min and > 30 min
- [ ] Upload progress bar displays correctly
- [ ] Transcription completes successfully for valid files
- [ ] Timestamp toggle produces segmented output
- [ ] Copy to clipboard works
- [ ] Download .txt works with correct filename
- [ ] Error states display properly with retry option
- [ ] Mobile responsiveness (tabs are tappable, upload zone works)
- [ ] Dark/light theme compatibility

### API Testing (curl)

```bash
# Test presign endpoint
curl -X POST http://localhost:4173/api/stt/presign \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.mp3","contentType":"audio/mpeg"}'

# Test transcribe endpoint (after upload)
curl -X POST http://localhost:4173/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d '{"uuid":"abc-123","timestamp":true}'
```

### Test Files

Prepare test audio files:
- [ ] Short file (~10 seconds) - MP3 format
- [ ] Medium file (~5 minutes) - WAV format
- [ ] Long file (~25 minutes) - OGG format
- [ ] Edge case (31+ minutes) - should be rejected
- [ ] Invalid format (test with .pdf or .txt) - should be rejected

---

## Security Considerations

### Server-Side Only Secrets

The following environment variables **MUST NEVER** be exposed to the client:

```bash
S3_STT_ACCESS_KEY   # Server-only
S3_STT_SECRET_KEY   # Server-only
RUNPOD_STT_API_KEY  # Server-only
```

### Presigned URL Security

- Presigned URLs expire after 1 hour (3600 seconds)
- URLs are scoped to a specific S3 key (UUID)
- No authentication required for PUT (URL itself is the auth)

### Validation

- **Client-side**: UX validation (file type, size, duration)
- **Server-side**: Security validation (defensive)
  - Re-validate content type on presign
  - Verify UUID format on transcribe
  - Add rate limiting endpoints later if needed

---

## Future Enhancements (Out of Scope for MVP)

- [ ] Authentication and user-specific transcription history
- [ ] Rate limiting per user/IP
- [ ] Multiple language selection UI (currently auto-detected)
- [ ] Speaker diarization (who spoke when)
- [ ] Batch transcription (multiple files)
- [ ] Export as SRT/VTT subtitles
- [ ] Audio waveform visualization with clickable timestamps
- [ ] Edit transcript and regenerate audio (TTS + STT loop)

---

## Implementation To-Do List

### Phase 1: Backend Foundation

- [ ] Add AWS SDK v3 dependencies to `package.json`
- [ ] Add S3 STT environment variables to `.env.example`
- [ ] Add RunPod STT environment variables to `.env.example`
- [ ] Implement `/api/stt/presign` endpoint in `server.js`
- [ ] Implement `/api/stt/transcribe` endpoint in `server.js`
- [ ] Test endpoints with curl/Postman
- [ ] Verify S3 presigned URLs work for PUT

### Phase 2: Frontend Hooks

- [ ] Create `src/hooks/useFileUpload.ts` hook
  - [ ] Implement `validateFile` function
  - [ ] Implement `uploadToS3` function with progress
  - [ ] Implement `getDuration` function using audio element
- [ ] Create `src/hooks/useSTT.ts` hook
  - [ ] Implement `getPresignedUrl` function
  - [ ] Implement `transcribe` function
  - [ ] Add loading and error state management

### Phase 3: STT Component

- [ ] Create `src/components/STTTab.tsx` component
- [ ] Implement drag-and-drop zone with MUI
- [ ] Add file picker button
- [ ] Add timestamp toggle switch
- [ ] Implement progress indicator
- [ ] Add result display area
- [ ] Add copy to clipboard functionality
- [ ] Add download as .txt functionality
- [ ] Add error display with retry option

### Phase 4: App Integration

- [ ] Modify `src/App.tsx` to add MUI Tabs
- [ ] Create TTS/STT tab state management
- [ ] Wrap existing TTS content in conditional render
- [ ] Integrate `STTTab` component
- [ ] Ensure theme context applies to STT tab

### Phase 5: Polish & Testing

- [ ] Test all supported file formats
- [ ] Test duration validation (under/over 30 min)
- [ ] Test copy to clipboard
- [ ] Test download .txt
- [ ] Test timestamp output format
- [ ] Test error states
- [ ] Test mobile responsiveness
- [ ] Update README.md with STT documentation
- [ ] Update CLAUDE.md with STT section

---

## Notes for Developer

1. **Audio Duration Parsing**: Use the HTML5 Audio API to get duration client-side:
```typescript
const getDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => resolve(0);
    audio.src = URL.createObjectURL(file);
  });
};
```

2. **Copy to Clipboard**: Use the Clipboard API with fallback:
```typescript
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
};
```

3. **Download .txt**: Create blob and trigger download:
```typescript
const downloadText = (text: string, filename: string) => {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
```

4. **Timestamp Formatting**: Convert seconds to MM:SS.ms:
```typescript
const formatTimestamp = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};
```

---

## Appendix: API Reference

### POST /api/stt/presign

**Request:**
```json
{
  "filename": "recording.mp3",
  "contentType": "audio/mpeg"
}
```

**Response (200):**
```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "presignedUrl": "https://s3.../X-Amz-Signature=...",
  "key": "550e8400-e29b-41d4-a716-446655440000.mp3"
}
```

**Error Response (400):**
```json
{
  "error": "Invalid file type"
}
```

### POST /api/stt/transcribe

**Request:**
```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": true
}
```

**Response (200) - Without Timestamps:**
```json
{
  "text": "This is the transcribed text with automatic punctuation and capitalization.",
  "success": true
}
```

**Response (200) - With Timestamps:**
```json
{
  "text": "This is the transcribed text.",
  "timestamps": {
    "word": [
      {"start": 0.0, "end": 0.25, "text": "This"},
      {"start": 0.25, "end": 0.4, "text": "is"},
      {"start": 0.4, "end": 0.55, "text": "the"}
    ],
    "segment": [
      {"start": 0.0, "end": 2.5, "segment": "This is the transcribed text."}
    ]
  },
  "success": true
}
```

**Error Response (500):**
```json
{
  "error": "Transcription service unavailable"
}
```

import { useState, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  FormControlLabel,
  Checkbox,
  IconButton,
  Paper,
  Alert,
} from '@mui/material';
import {
  CloudUpload,
  ContentCopy,
  Download,
} from '@mui/icons-material';
import { useSTT } from '../hooks/useSTT';
import { useFileUpload } from '../hooks/useFileUpload';

interface TranscriptionData {
  text: string;
  timestamps?: {
    word?: Array<{ start: number; end: number; text: string }>;
    segment?: Array<{ start: number; end: number; segment: string }>;
  };
}

export function STTTab() {
  const { loading: sttLoading, error: sttError, getPresignedUrl, transcribe, clearError } = useSTT();
  const { validateFile, uploadToS3, getDuration } = useFileUpload();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionData | null>(null);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loading = sttLoading || isUploading || isTranscribing;

  /**
   * Format timestamp to MM:SS.s
   */
  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
  };

  /**
   * Format transcription with timestamps
   */
  const formatTranscriptionText = (): string => {
    if (!transcription) return '';

    if (!includeTimestamps || !transcription.timestamps?.segment) {
      return transcription.text;
    }

    // Format with segment timestamps
    return transcription.timestamps.segment
      .map((seg) => `[${formatTimestamp(seg.start)} - ${formatTimestamp(seg.end)}] ${seg.segment}`)
      .join('\n');
  };

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    async (file: File) => {
      clearError();
      setError(null);
      setTranscription(null);

      // Validate file type and size
      const validation = validateFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Invalid file');
        return;
      }

      // Check duration
      try {
        const duration = await getDuration(file);
        if (duration > 30 * 60) {
          setError('Audio exceeds 30-minute limit. Please use a shorter file.');
          return;
        }
      } catch (err) {
        console.warn('Could not determine audio duration:', err);
        // Continue anyway - server will validate
      }

      setSelectedFile(file);
    },
    [validateFile, getDuration, clearError]
  );

  /**
   * Handle file input change
   */
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  /**
   * Handle drag events
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  /**
   * Upload and transcribe workflow
   */
  const handleTranscribe = async () => {
    if (!selectedFile) return;

    try {
      setError(null);
      clearError();

      // Step 1: Get presigned URL
      setIsUploading(true);
      const { uuid, presignedUrl } = await getPresignedUrl(
        selectedFile.name,
        selectedFile.type
      );

      // Step 2: Upload to S3
      await uploadToS3(selectedFile, presignedUrl, setUploadProgress);
      setIsUploading(false);

      // Step 3: Transcribe
      setIsTranscribing(true);
      const result = await transcribe(uuid, includeTimestamps);

      if (result.success) {
        setTranscription({
          text: result.text,
          timestamps: result.timestamps,
        });
      } else {
        throw new Error('Transcription failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
    } finally {
      setIsUploading(false);
      setIsTranscribing(false);
      setUploadProgress(0);
    }
  };

  /**
   * Copy to clipboard
   */
  const handleCopy = async () => {
    const textToCopy = formatTranscriptionText();

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  /**
   * Download as .txt
   */
  const handleDownload = () => {
    const textToDownload = formatTranscriptionText();
    const blob = new Blob([textToDownload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      {/* Upload Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Upload Audio
          </Typography>

          {/* Drag and Drop Zone */}
          <Paper
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              p: 4,
              textAlign: 'center',
              cursor: 'pointer',
              border: '2px dashed',
              borderColor: isDragging ? 'primary.main' : 'divider',
              bgcolor: isDragging ? 'action.hover' : 'background.paper',
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
              },
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".m4a,.mp3,.wav,.ogg,.opus,audio/*"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />

            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />

            {selectedFile ? (
              <>
                <Typography variant="body1" gutterBottom>
                  {selectedFile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="body1" gutterBottom>
                  Drop audio file here or click to upload
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Supported: .m4a, .mp3, .wav, .ogg, .opus
                  <br />
                  Max duration: 30 minutes
                </Typography>
              </>
            )}
          </Paper>

          {/* Options */}
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={includeTimestamps}
                  onChange={(e) => setIncludeTimestamps(e.target.checked)}
                  disabled={loading}
                />
              }
              label="Include timestamps in output"
            />
          </Box>

          {/* Transcribe Button */}
          <Button
            variant="contained"
            onClick={handleTranscribe}
            disabled={!selectedFile || loading}
            fullWidth
            sx={{ mt: 2 }}
          >
            {isUploading
              ? 'Uploading...'
              : isTranscribing
              ? 'Transcribing...'
              : 'Transcribe Audio'}
          </Button>

          {/* Progress Bar */}
          {isUploading && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress variant="determinate" value={uploadProgress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Uploading: {uploadProgress}%
              </Typography>
            </Box>
          )}

          {isTranscribing && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Transcribing audio...
              </Typography>
            </Box>
          )}

          {/* Error Display */}
          {(error || sttError) && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error || sttError}
            </Alert>
          )}

          {/* Success Message */}
          {copySuccess && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Copied to clipboard!
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Transcription Result */}
      {transcription && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Transcription Result</Typography>
              <Box>
                <IconButton onClick={handleCopy} title="Copy to clipboard">
                  <ContentCopy />
                </IconButton>
                <IconButton onClick={handleDownload} title="Download as .txt">
                  <Download />
                </IconButton>
              </Box>
            </Box>

            <Paper
              sx={{
                p: 2,
                bgcolor: 'background.default',
                maxHeight: 400,
                overflow: 'auto',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {formatTranscriptionText()}
            </Paper>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

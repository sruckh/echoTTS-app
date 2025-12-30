import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  LinearProgress,
  Alert,
  AlertTitle,
  IconButton,
  Paper
} from '@mui/material';
import {
  CloudUpload,
  Close
} from '@mui/icons-material';

interface VoiceCreationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (voiceId: string) => void;
  targetModel: string;
  createVoice: (params: { file: File; preferredName: string; targetModel: string }) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Voice Creation Dialog for Alibaba Cloud Qwen-TTS
 * Supports file input and drag-drop with validation
 */
export function VoiceCreationDialog({
  open,
  onClose,
  onSuccess,
  targetModel,
  createVoice,
  loading: externalLoading,
  error: externalError,
  clearError
}: VoiceCreationDialogProps) {
  const [voiceName, setVoiceName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setVoiceName('');
      setSelectedFile(null);
      setError(null);
    }
  }, [open]);

  // Validate voice name (alphanumeric and underscores only, max 16 chars)
  const validateVoiceName = useCallback((name: string): boolean => {
    return /^[a-zA-Z0-9_]{1,16}$/.test(name);
  }, []);

  // Validate file format
  const validateFile = useCallback((file: File): string | null => {
    const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/x-wav'];
    const validExtensions = ['.wav', '.mp3', '.m4a'];

    if (!validTypes.includes(file.type)) {
      const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      if (!validExtensions.includes(extension)) {
        return 'Invalid file format. Please upload WAV, MP3, or M4A.';
      }
    }

    // Size check: 10MB max
    if (file.size > 10 * 1024 * 1024) {
      return 'File size exceeds 10MB limit.';
    }

    return null;
  }, []);

  // Handle drag events
  const handleDrag = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setSelectedFile(null);
      } else {
        setError(null);
        setSelectedFile(file);
      }
    }
  }, [validateFile]);

  // Handle file selection via button
  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle input file change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setSelectedFile(null);
      } else {
        setError(null);
        setSelectedFile(file);
      }
    }
  }, [validateFile]);

  // Handle voice creation
  const handleCreate = async () => {
    // Clear external error
    clearError();

    // Validate inputs
    if (!voiceName.trim()) {
      setError('Please enter a voice name.');
      return;
    }

    if (!validateVoiceName(voiceName)) {
      setError('Voice name must be 1-16 characters, alphanumeric and underscores only.');
      return;
    }

    if (!selectedFile) {
      setError('Please select an audio file.');
      return;
    }

    // Call the hook's createVoice function
    const voiceId = await createVoice({
      file: selectedFile,
      preferredName: voiceName,
      targetModel: targetModel
    });

    if (voiceId) {
      onSuccess(voiceId);
      handleClose();
    }
    // If voiceId is null, the hook already set the error
  };

  const handleClose = () => {
    if (!externalLoading) {
      setVoiceName('');
      setSelectedFile(null);
      setError(null);
      clearError();
      onClose();
    }
  };

  // Display external error if no local error
  const displayError = error || externalError;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Create Custom Voice</Typography>
          <IconButton onClick={handleClose} disabled={externalLoading} size="small">
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={3} mt={1}>
          {/* Voice Name Input */}
          <TextField
            label="Voice Name"
            placeholder="e.g., my_voice"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            fullWidth
            disabled={externalLoading}
            error={voiceName.length > 0 && !validateVoiceName(voiceName)}
            helperText="1-16 characters, alphanumeric and underscores only"
            autoFocus
          />

          {/* File Upload Area */}
          <Box
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            sx={{
              border: '2px dashed',
              borderColor: dragActive ? 'primary.main' : 'grey.400',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              bgcolor: dragActive ? 'action.hover' : 'background.paper',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'action.hover'
              }
            }}
            onClick={handleFileSelect}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            {selectedFile ? (
              <Box>
                <Typography variant="subtitle1" fontWeight="bold" color="primary">
                  {selectedFile.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}
                  sx={{ mt: 2 }}
                >
                  Change File
                </Button>
              </Box>
            ) : (
              <Box>
                <Typography variant="subtitle1" fontWeight="bold">
                  Drop audio file here or click to browse
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  WAV, MP3, M4A • Max 10MB • Recommended: 10-60 seconds
                </Typography>
              </Box>
            )}
          </Box>

          {/* Audio Requirements Info */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'info.50' }}>
            <Typography variant="caption" color="text.secondary">
              <strong>Audio requirements:</strong> ≥24kHz sample rate, mono channel, clear reading without background noise. Optimal duration: 10-20 seconds (max 60s).
            </Typography>
          </Paper>

          {/* Error Display */}
          {displayError && (
            <Alert severity="error" onClose={() => { setError(null); clearError(); }}>
              <AlertTitle>Error</AlertTitle>
              {displayError}
            </Alert>
          )}

          {/* Loading Progress */}
          {externalLoading && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Creating voice... This may take a moment.
              </Typography>
              <LinearProgress />
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={externalLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!voiceName || !selectedFile || externalLoading}
        >
          Create Voice
        </Button>
      </DialogActions>
    </Dialog>
  );
}

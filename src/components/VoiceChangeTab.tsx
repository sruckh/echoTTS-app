import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Alert,
} from '@mui/material';
import { CloudUpload, Mic, Stop, Download } from '@mui/icons-material';
import { useFileUpload } from '../hooks/useFileUpload';

type InputSlot = 'source' | 'target';

interface AudioInputState {
  file: File | null;
  previewUrl: string | null;
  isDragging: boolean;
}

export function VoiceChangeTab() {
  const { validateFile, uploadToS3 } = useFileUpload();
  const [source, setSource] = useState<AudioInputState>({ file: null, previewUrl: null, isDragging: false });
  const [target, setTarget] = useState<AudioInputState>({ file: null, previewUrl: null, isDragging: false });
  const [recordingSlot, setRecordingSlot] = useState<InputSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [sourceUploadProgress, setSourceUploadProgress] = useState(0);
  const [targetUploadProgress, setTargetUploadProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const updateSlot = useCallback((slot: InputSlot, file: File | null, previewUrl: string | null) => {
    setError(null);
    setResultUrl(null);
    if (slot === 'source') {
      if (source.previewUrl) URL.revokeObjectURL(source.previewUrl);
      setSource(prev => ({ ...prev, file, previewUrl }));
    } else {
      if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      setTarget(prev => ({ ...prev, file, previewUrl }));
    }
  }, [source.previewUrl, target.previewUrl]);

  useEffect(() => {
    return () => {
      if (source.previewUrl) URL.revokeObjectURL(source.previewUrl);
      if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [source.previewUrl, target.previewUrl, resultUrl]);

  const handleFileSelect = useCallback((slot: InputSlot, file: File) => {
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file format.');
      return;
    }

    updateSlot(slot, file, URL.createObjectURL(file));
  }, [updateSlot]);

  const handleInputChange = (slot: InputSlot) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(slot, file);
    }
  };

  const handleDragOver = (slot: InputSlot) => (event: React.DragEvent) => {
    event.preventDefault();
    if (slot === 'source') {
      setSource(prev => ({ ...prev, isDragging: true }));
    } else {
      setTarget(prev => ({ ...prev, isDragging: true }));
    }
  };

  const handleDragLeave = (slot: InputSlot) => () => {
    if (slot === 'source') {
      setSource(prev => ({ ...prev, isDragging: false }));
    } else {
      setTarget(prev => ({ ...prev, isDragging: false }));
    }
  };

  const handleDrop = (slot: InputSlot) => (event: React.DragEvent) => {
    event.preventDefault();
    if (slot === 'source') {
      setSource(prev => ({ ...prev, isDragging: false }));
    } else {
      setTarget(prev => ({ ...prev, isDragging: false }));
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(slot, file);
    }
  };

  const startRecording = async (slot: InputSlot) => {
    if (recordingSlot) return;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      setRecordingSlot(slot);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const extension = mimeType.includes('opus') ? 'webm' : 'webm';
        const file = new File([blob], `recording-${slot}-${Date.now()}.${extension}`, { type: mimeType });
        updateSlot(slot, file, URL.createObjectURL(blob));
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingSlot(null);
      };

      recorder.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(message);
      setRecordingSlot(null);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const getPresignedUrl = async (file: File) => {
    const response = await fetch('/api/voice-change/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to generate upload URL');
    }

    return response.json();
  };

  const handleVoiceChange = async () => {
    if (!source.file || !target.file) return;

    setError(null);
    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const [sourcePresign, targetPresign] = await Promise.all([
        getPresignedUrl(source.file),
        getPresignedUrl(target.file),
      ]);

      await Promise.all([
        uploadToS3(source.file, sourcePresign.presignedUrl, setSourceUploadProgress),
        uploadToS3(target.file, targetPresign.presignedUrl, setTargetUploadProgress),
      ]);

      setUploadProgress(70);

      const response = await fetch('/api/voice-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_key: sourcePresign.key,
          target_key: targetPresign.key,
          output_format: 'mp3',
        }),
      });

      setUploadProgress(90);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Server returned ${response.status}`);
      }

      const data = await response.json();
      if (!data?.audio_url) {
        throw new Error('Voice change response missing audio_url');
      }

      setResultUrl(data.audio_url);
      setUploadProgress(100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Voice change failed';
      setError(message);
    } finally {
      setIsProcessing(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  const renderInputCard = (slot: InputSlot, label: string, state: AudioInputState) => (
    <Card sx={{ flex: 1 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
          {label}
        </Typography>

        <Box
          onDragOver={handleDragOver(slot)}
          onDragLeave={handleDragLeave(slot)}
          onDrop={handleDrop(slot)}
          sx={{
            border: '2px dashed',
            borderColor: state.isDragging ? 'primary.main' : 'grey.400',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            bgcolor: state.isDragging ? 'action.hover' : 'background.paper',
            mb: 2,
          }}
        >
          <CloudUpload sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
          <Typography variant="body2" color="text.secondary">
            Drop audio file here or click to upload
          </Typography>
          <Button
            component="label"
            variant="outlined"
            sx={{ mt: 2 }}
            disabled={isProcessing}
          >
            Upload Audio
            <input hidden type="file" accept="audio/*" onChange={handleInputChange(slot)} />
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
          <Button
            variant={recordingSlot === slot ? 'contained' : 'outlined'}
            color={recordingSlot === slot ? 'error' : 'primary'}
            startIcon={recordingSlot === slot ? <Stop /> : <Mic />}
            onClick={recordingSlot === slot ? stopRecording : () => startRecording(slot)}
            disabled={isProcessing || (!!recordingSlot && recordingSlot !== slot)}
          >
            {recordingSlot === slot ? 'Stop Recording' : 'Record'}
          </Button>
          {state.file && (
            <Typography variant="caption" color="text.secondary">
              {state.file.name}
            </Typography>
          )}
        </Box>

        {state.previewUrl && (
          <audio controls src={state.previewUrl} style={{ width: '100%' }} />
        )}
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Voice Changing</Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        {renderInputCard('source', 'Source Audio (content & timing)', source)}
        {renderInputCard('target', 'Target Audio (voice timbre)', target)}
      </Box>

      {(uploadProgress > 0 || sourceUploadProgress > 0 || targetUploadProgress > 0) && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="caption" color="text.secondary">
            Processing: {uploadProgress}%
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Source upload: {sourceUploadProgress}% | Target upload: {targetUploadProgress}%
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mb: 3 }}>
        <Button
          variant="contained"
          onClick={handleVoiceChange}
          disabled={!source.file || !target.file || isProcessing}
        >
          Voice Change
        </Button>
      </Box>

      {resultUrl && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
              Result
            </Typography>
            <audio controls src={resultUrl} style={{ width: '100%' }} />
            <Button
              variant="outlined"
              startIcon={<Download />}
              href={resultUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 2 }}
            >
              Download
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

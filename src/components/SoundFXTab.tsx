import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  TextField,
  Slider,
  Alert,
  CircularProgress,
  IconButton,
  Paper,
} from '@mui/material';
import { Download, Delete } from '@mui/icons-material';
import { useSoundFX } from '../hooks/useSoundFX';

export function SoundFXTab() {
  const { loading, error, result, generate, clearError, clearResult } = useSoundFX();
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(10);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    await generate(text, duration);
  };

  const handleDownload = () => {
    if (!result?.url) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.filename || `soundfx-${Date.now()}.wav`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleClear = () => {
    setText('');
    setDuration(10);
    clearError();
    clearResult();
  };

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Generate Sound Effect
          </Typography>

          <TextField
            label="Describe the sound effect"
            placeholder="e.g. thunder rumbling in the distance, heavy rain falling on a tin roof"
            multiline
            rows={3}
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            sx={{ mb: 3 }}
          />

          <Box sx={{ mb: 3, px: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Duration (seconds)
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {duration}s
              </Typography>
            </Box>
            <Slider
              value={duration}
              onChange={(_, value) => setDuration(value as number)}
              min={1}
              max={30}
              step={1}
              marks
              disabled={loading}
              valueLabelDisplay="auto"
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={handleClear} disabled={loading}>
              Clear
            </Button>
            <Button
              variant="contained"
              onClick={handleGenerate}
              disabled={loading || !text.trim()}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
            >
              {loading ? 'Generating...' : 'Generate Sound'}
            </Button>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={clearError}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Result</Typography>
              <Box>
                <IconButton onClick={handleDownload} title="Download WAV">
                  <Download />
                </IconButton>
                <IconButton onClick={clearResult} title="Clear result">
                  <Delete />
                </IconButton>
              </Box>
            </Box>

            <audio controls src={result.url} style={{ width: '100%' }} />

            <Paper sx={{ p: 1.5, mt: 2, bgcolor: 'background.default' }}>
              <Typography variant="caption" color="text.secondary">
                Duration: {result.metadata.duration_seconds?.toFixed(1) || '?'}s
                {' | '}
                Generation time: {result.metadata.generation_time_seconds?.toFixed(1) || '?'}s
                {' | '}
                Format: 24kHz WAV
              </Typography>
            </Paper>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

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
  Collapse,
} from '@mui/material';
import { Download, Delete, ExpandMore, ExpandLess } from '@mui/icons-material';
import { useSoundFX, SoundFXAdvancedParams } from '../hooks/useSoundFX';

const PROMPT_HINTS = [
  'Rain falling on a tin roof with distant thunder rumbling',
  'Birds chirping in a quiet forest at dawn with a gentle breeze',
  'A sports car roaring past on a highway',
  'Clear footsteps echoing on concrete at a steady rhythm',
  'Waves crashing on a rocky shore with seagulls overhead',
  'Campfire crackling and popping in a quiet forest at night',
  'Heavy wind howling through a mountain pass',
  'A crowded cafe with murmuring voices and clinking dishes',
];

export function SoundFXTab() {
  const { loading, error, result, generate, clearError, clearResult } = useSoundFX();
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(10);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [temperature, setTemperature] = useState(1.5);
  const [topP, setTopP] = useState(0.6);
  const [topK, setTopK] = useState(50);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.2);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    const advanced: SoundFXAdvancedParams = showAdvanced
      ? { audio_temperature: temperature, audio_top_p: topP, audio_top_k: topK, audio_repetition_penalty: repetitionPenalty }
      : {};
    await generate(text, duration, advanced);
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
    setTemperature(1.5);
    setTopP(0.6);
    setTopK(50);
    setRepetitionPenalty(1.2);
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

          <Alert severity="info" sx={{ mb: 2 }}>
            Best with <strong>environmental and ambient descriptions</strong> — weather, nature, urban scenes,
            footsteps, crowds, machinery. Short discrete sounds (e.g. "a kiss") are outside the model's design.
          </Alert>

          <TextField
            label="Describe the sound"
            placeholder={PROMPT_HINTS[Math.floor(Date.now() / 1000) % PROMPT_HINTS.length]}
            multiline
            rows={3}
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            sx={{ mb: 3 }}
            helperText="Describe an environment, scene, or ambient soundscape for best results"
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

          <Box sx={{ mb: 2 }}>
            <Button
              size="small"
              onClick={() => setShowAdvanced(!showAdvanced)}
              endIcon={showAdvanced ? <ExpandLess /> : <ExpandMore />}
            >
              Advanced Parameters
            </Button>
            <Collapse in={showAdvanced}>
              <Paper sx={{ p: 2, mt: 1 }} variant="outlined">
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Defaults match the model's recommended settings. Adjust to experiment with variation and coherence.
                </Typography>

                <Box sx={{ px: 1, mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Temperature</Typography>
                    <Typography variant="body2" fontWeight={600}>{temperature.toFixed(2)}</Typography>
                  </Box>
                  <Slider value={temperature} onChange={(_, v) => setTemperature(v as number)} min={0.1} max={5} step={0.1} disabled={loading} valueLabelDisplay="auto" />
                  <Typography variant="caption" color="text.secondary">Higher = more random/varied. Lower = more predictable.</Typography>
                </Box>

                <Box sx={{ px: 1, mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Top P (nucleus)</Typography>
                    <Typography variant="body2" fontWeight={600}>{topP.toFixed(2)}</Typography>
                  </Box>
                  <Slider value={topP} onChange={(_, v) => setTopP(v as number)} min={0.05} max={1} step={0.05} disabled={loading} valueLabelDisplay="auto" />
                  <Typography variant="caption" color="text.secondary">Lower = focus on most likely tokens. Higher = broader selection.</Typography>
                </Box>

                <Box sx={{ px: 1, mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Top K</Typography>
                    <Typography variant="body2" fontWeight={600}>{topK}</Typography>
                  </Box>
                  <Slider value={topK} onChange={(_, v) => setTopK(v as number)} min={1} max={200} step={1} disabled={loading} valueLabelDisplay="auto" />
                  <Typography variant="caption" color="text.secondary">Limits sampling to the K most likely tokens.</Typography>
                </Box>

                <Box sx={{ px: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Repetition Penalty</Typography>
                    <Typography variant="body2" fontWeight={600}>{repetitionPenalty.toFixed(2)}</Typography>
                  </Box>
                  <Slider value={repetitionPenalty} onChange={(_, v) => setRepetitionPenalty(v as number)} min={0.8} max={2} step={0.05} disabled={loading} valueLabelDisplay="auto" />
                  <Typography variant="caption" color="text.secondary">Higher = discourages repetitive audio patterns.</Typography>
                </Box>

                <Box sx={{ mt: 1, textAlign: 'right' }}>
                  <Button size="small" variant="text" onClick={() => { setTemperature(1.5); setTopP(0.6); setTopK(50); setRepetitionPenalty(1.2); }}>
                    Reset to Defaults
                  </Button>
                </Box>
              </Paper>
            </Collapse>
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

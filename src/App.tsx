import { useState, useEffect } from 'react';
import {
  Container, Box, Typography, TextField, Button, Select, MenuItem,
  FormControl, InputLabel, Card, CardContent, IconButton, CircularProgress,
  List, ListItem, ListItemText, ListItemSecondaryAction, Paper, Snackbar, Alert
} from '@mui/material';
import { PlayArrow, Pause, Delete, Download, LightMode, DarkMode } from '@mui/icons-material';
import { TTSVoice } from './config';
import { useColorMode } from './contexts/ThemeContext';
import { useTTS } from './hooks/useTTS';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useHistory, HistoryItem } from './hooks/useHistory';
import { useObjectUrls } from './hooks/useObjectUrls';

function App() {
  const { mode, toggleMode } = useColorMode();
  const { loading, error: ttsError, generate, config } = useTTS();
  const { playingId, error: audioError, play, pause } = useAudioPlayer();
  const { history, addItem, removeItem } = useHistory();
  const { objectUrls, createUrl, revokeUrl } = useObjectUrls();

  const [text, setText] = useState('');
  const [voice, setVoice] = useState(config.voices[0]?.id || 'alloy');

  const error = ttsError || audioError;

  // Create object URLs for any history items that don't have them
  useEffect(() => {
    if (history.length === 0) return;

    // Find items that don't have URLs yet
    const itemsNeedingUrls = history.filter(item => !objectUrls[item.id]);

    if (itemsNeedingUrls.length > 0) {
      // Create URLs only for items that need them
      itemsNeedingUrls.forEach(item => {
        createUrl(item.id, item.blob);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const handleGenerate = async () => {
    if (!text.trim()) return;

    const blob = await generate({ text, voice });
    if (!blob) return;

    const newItem: HistoryItem = {
      id: Date.now().toString(),
      text,
      voice,
      blob,
      timestamp: Date.now(),
    };

    const newHistory = await addItem(newItem);

    // Revoke URL of dropped item if we exceeded max history
    if (newHistory.length === 5 && history.length === 5) {
      const droppedId = history[4].id;
      revokeUrl(droppedId);
    }

    // Create URL and auto-play
    const url = createUrl(newItem.id, blob);
    play(newItem.id, url);
  };

  const handleDelete = async (id: string) => {
    const removed = await removeItem(id);
    if (removed) {
      revokeUrl(id);
      if (playingId === id) {
        pause();
      }
    }
  };

  const handleDownload = (id: string) => {
    const url = objectUrls[id];
    if (!url) return;
    const item = history.find(h => h.id === id);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-tts-${item?.voice}-${id}.ogg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleClear = () => {
    setText('');
    setVoice(config.voices[0]?.id || 'alloy');
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Echo TTS
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {config.model}
          </Typography>
          <IconButton onClick={toggleMode} size="small" color="inherit">
            {mode === 'dark' ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Box>
      </Box>

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <TextField
            label="Prompt"
            multiline
            rows={4}
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            sx={{ mb: 2 }}
          />
          
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Voice</InputLabel>
              <Select
                value={voice}
                label="Voice"
                onChange={(e) => setVoice(e.target.value)}
                disabled={loading}
              >
                {config.voices.map((v: TTSVoice) => (
                  <MenuItem key={v.id} value={v.id}>{v.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={handleClear} disabled={loading}>
              Clear
            </Button>
            <Button 
              variant="contained" 
              onClick={handleGenerate} 
              disabled={loading || !text.trim()}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <PlayArrow />}
            >
              {loading ? 'Generating...' : 'Generate & Play'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ mb: 2 }}>History</Typography>
      
      <Paper elevation={2}>
        <List>
            {history.length === 0 && (
                <ListItem>
                    <ListItemText primary="No history yet." secondary="Generated audio will appear here." />
                </ListItem>
            )}
            {history.map((item) => (
              <ListItem
                key={item.id}
                divider
                sx={{ pr: { xs: 17, sm: 18 } }}
              >
                <ListItemText
                  primary={
                    <Typography
                      variant="body1"
                      noWrap
                      sx={{
                        pr: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                        {item.text}
                    </Typography>
                  }
                  secondary={`${item.voice} • ${new Date(item.timestamp).toLocaleTimeString()}`}
                  sx={{ pr: 1 }}
                />
                <ListItemSecondaryAction>
                  <IconButton
                    onClick={() => {
                      const url = objectUrls[item.id];
                      if (url) {
                        play(item.id, url);
                      } else {
                        console.error('[DEBUG] No URL for item:', item.id, 'Available URLs:', Object.keys(objectUrls));
                      }
                    }}
                    size="small"
                    disabled={!objectUrls[item.id]}
                  >
                    {playingId === item.id ? <Pause /> : <PlayArrow />}
                  </IconButton>
                  <IconButton
                    onClick={() => handleDownload(item.id)}
                    size="small"
                  >
                    <Download />
                  </IconButton>
                  <IconButton
                    edge="end"
                    onClick={() => handleDelete(item.id)}
                    size="small"
                  >
                    <Delete />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
        </List>
      </Paper>

      <Snackbar open={!!error} autoHideDuration={6000}>
        <Alert severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default App;

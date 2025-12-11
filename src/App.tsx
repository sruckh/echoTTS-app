import React, { useState, useEffect, useRef } from 'react';
import { 
  Container, Box, Typography, TextField, Button, Select, MenuItem, 
  FormControl, InputLabel, Card, CardContent, IconButton, CircularProgress,
  List, ListItem, ListItemText, ListItemSecondaryAction, Paper, Snackbar, Alert
} from '@mui/material';
import { PlayArrow, Pause, Delete, Download, Refresh } from '@mui/icons-material';
import { get, set } from 'idb-keyval';
import { getConfig, TTSVoice } from './config';

interface HistoryItem {
  id: string;
  text: string;
  voice: string;
  blob: Blob; // We store the blob in IDB/memory, but use URL for playback
  timestamp: number;
}

// Helper to store only serializable data in IDB (Blob is serializable)
const DB_KEY = 'tts-history';

function App() {
  const [config] = useState(getConfig());
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(config.voices[0]?.id || 'alloy');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // We keep object URLs in a separate map or just generate them on the fly for the list.
  // Actually, generating on fly is fine if we have the blob.
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load history on mount
  useEffect(() => {
    get<HistoryItem[]>(DB_KEY).then((val) => {
      if (val) {
        setHistory(val);
        // Create URLs for them
        const urls: Record<string, string> = {};
        val.forEach(item => {
          urls[item.id] = URL.createObjectURL(item.blob);
        });
        setObjectUrls(urls);
      }
    });
  }, []);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(objectUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [objectUrls]);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    if (!config.endpoint) {
        setError("Configuration Error: No TTS Endpoint defined.");
        return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: text,
          voice: voice,
          format: 'opus', // Requesting opus in ogg
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      // Ensure it has the right type if the server didn't set it
      const audioBlob = new Blob([blob], { type: 'audio/ogg; codecs=opus' });
      
      const newItem: HistoryItem = {
        id: Date.now().toString(),
        text,
        voice,
        blob: audioBlob,
        timestamp: Date.now(),
      };

      const newHistory = [newItem, ...history].slice(0, 5);
      
      // Revoke old URLs if we dropped an item
      if (history.length >= 5) {
        const dropped = history[4];
        if (objectUrls[dropped.id]) {
            URL.revokeObjectURL(objectUrls[dropped.id]);
        }
      }

      // Update State
      const newUrl = URL.createObjectURL(audioBlob);
      setObjectUrls(prev => ({ ...prev, [newItem.id]: newUrl }));
      setHistory(newHistory);
      
      // Save to IDB
      await set(DB_KEY, newHistory);

      // Auto-play
      playAudio(newItem.id, newUrl);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate audio');
    } finally {
      setLoading(false);
    }
  };

  const playAudio = (id: string, url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      if (playingId === id) {
        setPlayingId(null);
        return;
      }
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(id);
    
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
        setError("Error during playback");
        setPlayingId(null);
    };
    
    audio.play().catch(e => {
        console.error("Play error", e);
        setError("Autoplay blocked or failed.");
    });
  };

  const handleDelete = async (id: string) => {
    const newHistory = history.filter(h => h.id !== id);
    setHistory(newHistory);
    await set(DB_KEY, newHistory);
    if (objectUrls[id]) {
        URL.revokeObjectURL(objectUrls[id]);
        const newUrls = { ...objectUrls };
        delete newUrls[id];
        setObjectUrls(newUrls);
    }
    if (playingId === id && audioRef.current) {
        audioRef.current.pause();
        setPlayingId(null);
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
        <Typography variant="caption" color="text.secondary">
          {config.model}
        </Typography>
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
              <ListItem key={item.id} divider>
                <ListItemText
                  primary={
                    <Typography variant="body1" noWrap sx={{ maxWidth: '60vw' }}>
                        {item.text}
                    </Typography>
                  }
                  secondary={`${item.voice} • ${new Date(item.timestamp).toLocaleTimeString()}`}
                />
                <ListItemSecondaryAction>
                  <IconButton onClick={() => playAudio(item.id, objectUrls[item.id])}>
                    {playingId === item.id ? <Pause /> : <PlayArrow />}
                  </IconButton>
                  <IconButton onClick={() => handleDownload(item.id)}>
                    <Download />
                  </IconButton>
                  <IconButton edge="end" onClick={() => handleDelete(item.id)}>
                    <Delete />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
        </List>
      </Paper>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default App;

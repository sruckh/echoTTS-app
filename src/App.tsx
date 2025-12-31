import { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Typography, TextField, Button, Select, MenuItem,
  FormControl, InputLabel, Card, CardContent, IconButton, CircularProgress,
  List, ListItem, ListItemText, ListItemSecondaryAction, Paper, Snackbar, Alert,
  Tabs, Tab
} from '@mui/material';
import { PlayArrow, Pause, Delete, Download, LightMode, DarkMode, Add } from '@mui/icons-material';
import { TTSService } from './config';
import { useColorMode } from './contexts/ThemeContext';
import { useTTS } from './hooks/useTTS';
import { useAlibabaTTS } from './hooks/useAlibabaTTS';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useHistory, HistoryItem } from './hooks/useHistory';
import { useObjectUrls } from './hooks/useObjectUrls';
import { useAlibabaVoices, AlibabaVoice } from './hooks/useAlibabaVoices';
import { VoiceCreationDialog } from './components/VoiceCreationDialog';
import { STTTab } from './components/STTTab';

function App() {
  const { mode, toggleMode } = useColorMode();
  const { loading: httpLoading, error: httpTtsError, generate: httpGenerate, config } = useTTS();
  const { loading: wsLoading, error: wsTtsError, generate: wsGenerate } = useAlibabaTTS();
  const { playingId, error: audioError, play, pause } = useAudioPlayer();
  const { history, addItem, removeItem } = useHistory();
  const { objectUrls, createUrl, revokeUrl } = useObjectUrls();
  const {
    voices: alibabaVoices,
    loading: voicesLoading,
    error: voicesError,
    listVoices,
    createVoice,
    clearError: clearVoicesError
  } = useAlibabaVoices();

  const [text, setText] = useState('');
  const [voice, setVoice] = useState(config.voices[0]?.id || '');
  const [selectedService, setSelectedService] = useState<TTSService | undefined>(config.services[0]);
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<'tts' | 'stt'>('tts');

  const loading = httpLoading || wsLoading;
  const error = httpTtsError || wsTtsError || audioError || voicesError;
  const isAlibabaService = selectedService?.id === 'alibaba';

  // Load Alibaba voices when service is selected
  useEffect(() => {
    if (selectedService?.id === 'alibaba' && alibabaVoices.length === 0) {
      listVoices();
    }
  }, [selectedService?.id, alibabaVoices.length, listVoices]);

  // Initialize selected service if not already set
  useEffect(() => {
    if (!selectedService && config.services.length > 0) {
      setSelectedService(config.services[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!text.trim() || !selectedService) return;

    let blob: Blob | null = null;

    // Use WebSocket for Alibaba, HTTP for others
    if (selectedService.id === 'alibaba') {
      blob = await wsGenerate({
        text,
        voice,
        service: selectedService
      });
    } else {
      blob = await httpGenerate({
        text,
        voice,
        serviceId: selectedService.id
      });
    }

    if (!blob) return;

    const timestamp = Date.now();
    const newItem: HistoryItem = {
      id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      text,
      voice,
      blob,
      timestamp,
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
    setVoice(isAlibabaService ? (alibabaVoices[0]?.voice || '') : (config.voices[0]?.id || ''));
  };

  // Voice creation success handler
  const handleVoiceCreated = useCallback((voiceId: string) => {
    setVoice(voiceId);
    setVoiceDialogOpen(false);
    clearVoicesError();
  }, [clearVoicesError]);

  // Get current voices based on service selection
  const getCurrentVoices = useCallback((): { id: string; label: string }[] => {
    if (isAlibabaService) {
      return alibabaVoices.map((v: AlibabaVoice) => {
        // Extract preferred_name from voice ID format: qwen-tts-vc-{name}-voice-{timestamp}-{hash}
        const match = v.voice.match(/qwen-tts-vc-(.+?)-voice-/);
        const displayName = match ? match[1] : v.voice;

        return {
          id: v.voice,
          label: displayName // Use extracted preferred_name
        };
      });
    }
    return config.voices;
  }, [isAlibabaService, alibabaVoices, config.voices]);

  // Update voice when service changes
  useEffect(() => {
    const currentVoices = getCurrentVoices();
    if (currentVoices.length > 0 && !currentVoices.find(v => v.id === voice)) {
      setVoice(currentVoices[0].id);
    }
  }, [selectedService?.id, getCurrentVoices, voice]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: 'tts' | 'stt') => {
    setCurrentTab(newValue);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Box
          component="img"
          src="/echo-gemneye-xyz-hero.jpg"
          alt="Echo Voice Studio Hero"
          sx={{
            width: '100%',
            height: 'auto',
            maxHeight: '300px',
            objectFit: 'cover',
            borderRadius: 4,
            mb: 3,
            boxShadow: 3
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Typography
            variant="h4"
            component="h1"
            fontWeight="900"
            sx={{
              background: 'linear-gradient(to right, #8A2387, #E94057, #F27121)',
              backgroundClip: 'text',
              textFillColor: 'transparent',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.2))',
              letterSpacing: '-1px',
              fontSize: {
                xs: '1.4rem',
                sm: '1.8rem',
                md: '2.125rem'
              },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            Echo: Multi-Model Voice Studio
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
      </Box>

      {/* Tabs Navigation */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={handleTabChange}>
          <Tab label="Text to Speech" value="tts" />
          <Tab label="Speech to Text" value="stt" />
        </Tabs>
      </Box>

      {/* TTS Tab Content */}
      {currentTab === 'tts' && (
        <>
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
            {config.services.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Service</InputLabel>
                <Select
                  value={selectedService?.id || ''}
                  label="Service"
                  onChange={(e) => {
                    const service = config.services.find(s => s.id === e.target.value);
                    setSelectedService(service);
                  }}
                  disabled={loading}
                >
                  {config.services.map((s: TTSService) => (
                    <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl fullWidth>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flexGrow: 1 }}>
                  <InputLabel>Voice</InputLabel>
                  <Select
                    value={voice}
                    label="Voice"
                    onChange={(e) => setVoice(e.target.value)}
                    disabled={loading || (isAlibabaService && voicesLoading)}
                    fullWidth
                    MenuProps={{
                      PaperProps: {
                        style: {
                          maxHeight: 300, // Limit dropdown height
                          overflow: 'auto' // Enable scrolling
                        }
                      }
                    }}
                  >
                    {getCurrentVoices().map((v: { id: string; label: string }) => (
                      <MenuItem key={v.id} value={v.id}>{v.label}</MenuItem>
                    ))}
                    {isAlibabaService && alibabaVoices.length === 0 && !voicesLoading && (
                      <MenuItem disabled>No voices yet. Create one below.</MenuItem>
                    )}
                  </Select>
                </Box>
                {isAlibabaService && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setVoiceDialogOpen(true)}
                    disabled={loading}
                    startIcon={<Add />}
                    sx={{ minWidth: 'fit-content', alignSelf: 'flex-end', mb: 1 }}
                  >
                    Create
                  </Button>
                )}
              </Box>
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

          {/* Voice Creation Dialog for Alibaba */}
          <VoiceCreationDialog
            open={voiceDialogOpen}
            onClose={() => setVoiceDialogOpen(false)}
            onSuccess={handleVoiceCreated}
            targetModel={selectedService?.targetModel || 'qwen3-tts-vc-realtime-2025-11-27'}
            createVoice={createVoice}
            loading={voicesLoading}
            error={voicesError}
            clearError={clearVoicesError}
          />
        </>
      )}

      {/* STT Tab Content */}
      {currentTab === 'stt' && <STTTab />}
    </Container>
  );
}

export default App;

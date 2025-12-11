import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4173; // Standard Vite preview port, or whatever implementation.md said (it said 4173 or internal)

const DIST_DIR = path.join(__dirname, 'dist');

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static assets (except index.html which we handle specifically for injection, 
// though typical static middleware might grab it first if we aren't careful.
// We can serve assets from dist/assets specifically, or just serve dist with index:false)
app.use(express.static(DIST_DIR, { index: false }));

// Helper to filter and get env vars
const getRuntimeEnv = () => {
  const env = {};
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('VITE_')) {
      env[key] = process.env[key];
    }
  });
  return env;
};

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  const indexFile = path.join(DIST_DIR, 'index.html');
  
  fs.readFile(indexFile, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading index.html:', err);
      return res.status(500).send('Server Error');
    }

    const envConfig = getRuntimeEnv();
    const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;

    // Replace the placeholder or just inject into head
    // Our index.html has <script id="env-config">window.__ENV__ = { ... };</script>
    // We can use a regex to replace the content of that script tag, or just the assignment.
    
    // Simple replacement of the assignment inside the known script ID context if possible, 
    // or just a regex for window.__ENV__ = { ... };
    
    const result = data.replace(
      /window\.__ENV__\s*=\s*\{[^}]*\};?/s, // Match multiline
      envScript
    );

    res.send(result);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

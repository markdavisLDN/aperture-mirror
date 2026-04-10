const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PLAYLIST_PATH = path.join(__dirname, 'assets', 'playlist.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// Playlist API
app.get('/api/playlist', (req, res) => {
  try {
    const data = fs.readFileSync(PLAYLIST_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: 'Could not read playlist' });
  }
});

app.post('/api/playlist', (req, res) => {
  try {
    fs.writeFileSync(PLAYLIST_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not write playlist' });
  }
});

// WebSocket — hardware bridge (future physical build)
wss.on('connection', (ws, req) => {
  console.log('[WS] Hardware client connected from', req.socket.remoteAddress);
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'frame') {
        // Future: distribute to PCA9685 boards via I2C
        ws.send(JSON.stringify({ type: 'ack', frameId: msg.frameId }));
      }
    } catch (e) {
      console.error('[WS] Bad message:', e.message);
    }
  });
  ws.on('close', () => console.log('[WS] Hardware client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Aperture Mirror running on http://localhost:${PORT}`);
});

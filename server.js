const express = require('express');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// DEAD SIMPLE - Single WhatsApp client
let client = null;
let qrString = null;
let isReady = false;

// Initialize WhatsApp client
function initWhatsApp() {
  console.log('🚀 Initializing WhatsApp client...');
  
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser' || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('📱 QR Code received');
    qrString = qr;
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    isReady = true;
    qrString = null;
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
  });

  client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp disconnected:', reason);
    isReady = false;
  });

  client.initialize();
}

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    ready: isReady,
    hasQR: !!qrString
  });
});

app.get('/api/qr', async (req, res) => {
  if (!qrString) {
    return res.json({ qr: null });
  }
  
  try {
    const qrImage = await qrcode.toDataURL(qrString);
    res.json({ qr: qrImage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  
  if (!isReady) {
    return res.status(400).json({ error: 'WhatsApp not ready' });
  }
  
  try {
    const result = await client.sendMessage(to, message);
    res.json({ success: true, id: result.id._serialized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  initWhatsApp();
});
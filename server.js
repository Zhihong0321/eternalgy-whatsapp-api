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
  
  // Railway Chrome executable detection
  const fs = require('fs');
  let executablePath;
  
  // Check for Railway/nixpacks Chrome paths
  const possiblePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ];
  
  for (const path of possiblePaths) {
    if (path && fs.existsSync(path)) {
      executablePath = path;
      console.log(`✅ Found Chrome at: ${executablePath}`);
      break;
    }
  }
  
  const puppeteerConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  };
  
  // Only set executablePath if we found one
  if (executablePath) {
    puppeteerConfig.executablePath = executablePath;
  }
  
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig
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
    // Format phone number for WhatsApp
    let formattedNumber = to.replace(/\D/g, ''); // Remove non-digits
    
    // Validate number length (should be 10-15 digits with country code)
    if (formattedNumber.length < 10 || formattedNumber.length > 15) {
      throw new Error('Invalid phone number length. Include country code (10-15 digits total)');
    }
    
    // WhatsApp format: number@c.us
    const chatId = formattedNumber + '@c.us';
    
    console.log(`📤 Sending message to ${chatId}: ${message}`);
    
    const result = await client.sendMessage(chatId, message);
    res.json({ 
      success: true, 
      id: result.id._serialized,
      to: chatId 
    });
  } catch (error) {
    console.error('❌ Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  initWhatsApp();
});
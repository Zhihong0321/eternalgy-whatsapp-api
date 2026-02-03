const express = require('express');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// Webhook configuration
let webhookUrl = process.env.WEBHOOK_URL || null;
let webhookEnabled = false;

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Documentation route
app.get('/api/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
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

  // Use Railway persistent volume for session storage (default: /storage)
  const sessionPath = process.env.WWEBJS_AUTH_PATH || '/storage/.wwebjs_auth';
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath,
      clientId: 'whatsapp-api-session'
    }),
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

  // Message received handler - triggers webhook
  client.on('message', async (message) => {
    console.log('📨 Message received:', {
      from: message.from,
      body: message.body,
      timestamp: message.timestamp
    });

    // Trigger webhook if enabled
    if (webhookEnabled && webhookUrl) {
      try {
        const contact = await message.getContact();
        const chat = await message.getChat();
        
        const webhookPayload = {
          id: message.id._serialized,
          from: message.from,
          fromName: contact.pushname || contact.name || message.from,
          body: message.body,
          timestamp: message.timestamp,
          hasMedia: message.hasMedia,
          type: message.type,
          isGroup: chat.isGroup,
          chatName: chat.name
        };

        console.log('🔔 Triggering webhook:', webhookUrl);
        
        await axios.post(webhookUrl, webhookPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        console.log('✅ Webhook triggered successfully');
      } catch (error) {
        console.error('❌ Webhook error:', error.message);
      }
    }
  });

  client.initialize();
}

// API Routes
app.get('/api', (req, res) => {
  res.json({
    name: 'WhatsApp API',
    version: '1.0.0',
    description: 'Send WhatsApp messages via API',
    endpoints: {
      'GET /api/status': 'Check WhatsApp connection status',
      'GET /api/qr': 'Get QR code for authentication',
      'POST /api/send': 'Send WhatsApp message',
      'POST /api/check-user': 'Check if phone number is WhatsApp user and get profile info',
      'GET /api/webhook': 'Get webhook configuration',
      'POST /api/webhook': 'Set webhook URL',
      'DELETE /api/webhook': 'Disable webhook',
      'GET /api/docs': 'View API documentation'
    },
    documentation: '/api/docs'
  });
});

app.get('/api/status', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  res.json({
    ready: isReady,
    hasQR: !!qrString
  });
});

app.get('/api/qr', async (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
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

app.post('/api/check-user', async (req, res) => {
  const { phone } = req.body;

  if (!isReady) {
    return res.status(400).json({ error: 'WhatsApp not ready' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    // Format phone number for WhatsApp
    let formattedNumber = phone.replace(/\D/g, ''); // Remove non-digits

    // Validate number length (should be 10-15 digits with country code)
    if (formattedNumber.length < 10 || formattedNumber.length > 15) {
      throw new Error('Invalid phone number length. Include country code (10-15 digits total)');
    }

    // WhatsApp format: number@c.us
    const chatId = formattedNumber + '@c.us';

    console.log(`🔍 Checking user: ${chatId}`);

    // Check if number is registered on WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);

    if (!isRegistered) {
      return res.json({
        success: true,
        isWhatsAppUser: false,
        phone: formattedNumber,
        message: 'This number is not a WhatsApp user'
      });
    }

    // Get contact info
    const contact = await client.getContactById(chatId);

    // Get profile picture URL
    let profilePicUrl = null;
    try {
      profilePicUrl = await client.getProfilePicUrl(chatId);
    } catch (picError) {
      console.log('No profile picture or privacy settings prevent access');
    }

    res.json({
      success: true,
      isWhatsAppUser: true,
      phone: formattedNumber,
      name: contact.pushname || contact.name || null,
      profilePicture: profilePicUrl
    });
  } catch (error) {
    console.error('❌ Check user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook management endpoints
app.get('/api/webhook', (req, res) => {
  res.json({
    enabled: webhookEnabled,
    url: webhookUrl ? webhookUrl.replace(/(?<=:\/\/).*(?=@)/, '***') : null // Hide credentials if any
  });
});

app.post('/api/webhook', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Webhook URL is required' });
  }
  
  // Basic URL validation
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  webhookUrl = url;
  webhookEnabled = true;
  
  console.log('✅ Webhook configured:', url);
  
  res.json({
    success: true,
    enabled: webhookEnabled,
    url: webhookUrl.replace(/(?<=:\/\/).*(?=@)/, '***')
  });
});

app.delete('/api/webhook', (req, res) => {
  webhookEnabled = false;
  console.log('🔕 Webhook disabled');
  
  res.json({
    success: true,
    enabled: false
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
  initWhatsApp();
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_PATH = process.env.WWEBJS_AUTH_PATH || '/storage/.wwebjs_auth';
const STATE_PATH = process.env.WWEBJS_STATE_PATH || '/storage/.wwebjs_state.json';

app.use(express.json());
app.use(express.static('public'));

// Webhook configuration - try to load from state file first, fallback to env var
let webhookUrl = null;
let webhookEnabled = false;

// Load persisted webhook config from disk
function loadWebhookConfig() {
  try {
    const state = readStateFile();
    if (state && state.webhookUrl) {
      webhookUrl = state.webhookUrl;
      webhookEnabled = state.webhookEnabled || false;
      console.log(`🔔 Webhook loaded from saved state:`);
      console.log(`   URL: ${webhookUrl}`);
      console.log(`   Status: ${webhookEnabled ? 'ENABLED' : 'DISABLED'}`);
      return true;
    }
  } catch (err) {
    console.log('🔕 No saved webhook config found');
  }
  return false;
}

// Save webhook config to disk
function saveWebhookConfig() {
  try {
    const currentState = readStateFile() || {};
    currentState.webhookUrl = webhookUrl;
    currentState.webhookEnabled = webhookEnabled;
    currentState.updatedAt = new Date().toISOString();
    
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(currentState, null, 2));
    console.log(`💾 Webhook config saved to disk`);
  } catch (err) {
    console.error('❌ Failed to save webhook config:', err.message);
  }
}

// Initialize webhook config
if (!loadWebhookConfig()) {
  // Fallback to environment variable
  webhookUrl = process.env.WEBHOOK_URL || null;
  webhookEnabled = !!process.env.WEBHOOK_URL;
  
  if (webhookEnabled) {
    console.log(`🔔 Webhook auto-configured from environment:`);
    console.log(`   URL: ${webhookUrl}`);
    console.log(`   Status: ENABLED`);
    saveWebhookConfig();
  } else {
    console.log(`🔕 Webhook not configured (set WEBHOOK_URL env var or use /api/webhook)`);
  }
}

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
let lastQrAt = null;
let lastReadyAt = null;
let lastAuthAt = null;
let lastDisconnectAt = null;
let lastClientState = null;

function setNoCache(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
}

function getMemoryState() {
  return {
    ready: isReady,
    hasQR: !!qrString,
    qr: qrString || null,
    lastQrAt,
    lastReadyAt,
    lastAuthAt,
    lastDisconnectAt,
    lastClientState
  };
}

function getEffectiveState() {
  const mem = getMemoryState();
  if (mem.ready || mem.hasQR) return mem;

  const disk = readStateFile();
  if (!disk) return mem;

  return {
    ...mem,
    ...disk,
    ready: !!disk.ready,
    hasQR: !!disk.hasQR,
    qr: disk.qr || null
  };
}

function writeStateFile() {
  try {
    const payload = {
      ...getMemoryState(),
      updatedAt: new Date().toISOString()
    };
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(payload));
  } catch (err) {
    console.error('⚠️ Failed to write state file:', err && err.message ? err.message : err);
  }
}

function readStateFile() {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('⚠️ Failed to read state file:', err && err.message ? err.message : err);
    return null;
  }
}

// Initialize WhatsApp client
function initWhatsApp() {
  console.log('🚀 Initializing WhatsApp client...');
  
  // Railway Chrome executable detection
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

  // Use Railway persistent volume for session storage (default: /storage).
  // Fail fast if storage is missing or not writable.
  const sessionPath = AUTH_PATH;
  try {
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    const testFile = path.join(sessionPath, '.rw_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (err) {
    console.error('❌ Persistent storage not available or not writable:', sessionPath);
    console.error(err && err.message ? err.message : err);
    process.exit(1);
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
    lastQrAt = new Date().toISOString();
    writeStateFile();
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    isReady = true;
    qrString = null;
    lastReadyAt = new Date().toISOString();
    writeStateFile();
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
    lastAuthAt = new Date().toISOString();
    writeStateFile();
  });

  client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp disconnected:', reason);
    isReady = false;
    lastDisconnectAt = new Date().toISOString();
    writeStateFile();
  });

  // DEBUG: Listen to ALL events to see what's happening
  client.on('message_create', (msg) => {
    console.log('📝 MESSAGE_CREATE event:', msg.from, msg.body?.substring(0, 30));
  });

  client.on('message_ack', (msg, ack) => {
    console.log('✓ MESSAGE_ACK event:', ack, msg.from);
  });

  client.on('change_state', (state) => {
    console.log('🔄 CHANGE_STATE event:', state);
  });

  client.on('loading_screen', (percent, message) => {
    console.log('⏳ LOADING_SCREEN:', percent, message);
  });

  client.on('auth_failure', (msg) => {
    console.log('🔒 AUTH_FAILURE:', msg);
  });

  // Periodically check client state in case events are missed
  setInterval(async () => {
    try {
      const state = await client.getState();
      if (state && state !== lastClientState) {
        lastClientState = state;
        console.log('ℹ️ WhatsApp client state:', state);
      }
      if (state === 'CONNECTED' && !isReady) {
        isReady = true;
        lastReadyAt = new Date().toISOString();
      }
      writeStateFile();
    } catch (err) {
      // Ignore transient state errors
    }
  }, 5000);

  // Message received handler - triggers webhook
  console.log('🔔 Registering message event listener...');
  
  client.on('message', async (message) => {
    try {
      // Defensive: message might be malformed
      if (!message) {
        console.log('❌ MESSAGE EVENT: message is null/undefined');
        return;
      }
      
      const receivedAt = new Date().toISOString();
      const msgId = message.id?._serialized || message.id || 'unknown';
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📨📨📨 MESSAGE EVENT FIRING 📨📨📨');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🆔 Message ID: ${msgId}`);
      console.log(`👤 From: ${message.from || 'unknown'}`);
      console.log(`💬 Body: ${message.body || '(empty)'}`);
      console.log(`⏰ Timestamp: ${message.timestamp}`);
      console.log(`📊 Type: ${message.type || 'unknown'}`);
      console.log(`🕐 Received at: ${receivedAt}`);
      console.log(`🔔 Webhook State: Enabled=${webhookEnabled}, URL=${webhookUrl ? 'SET' : 'NULL'}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Trigger webhook if enabled
    if (webhookEnabled && webhookUrl) {
      const webhookStartTime = Date.now();
      const logId = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🔔 WEBHOOK FIRE [${logId}] - START`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`⏰ Time: ${new Date().toISOString()}`);
      console.log(`🎯 URL: ${webhookUrl}`);
      
      try {
        // Get contact and chat info with error handling
        let contact = null;
        let chat = null;
        
        try {
          contact = await message.getContact();
          console.log(`✅ Got contact: ${contact.pushname || contact.name || 'unknown'}`);
        } catch (contactErr) {
          console.log(`⚠️  Could not get contact: ${contactErr.message}`);
        }
        
        try {
          chat = await message.getChat();
          console.log(`✅ Got chat: ${chat.name || 'unknown'}, isGroup: ${chat.isGroup}`);
        } catch (chatErr) {
          console.log(`⚠️  Could not get chat: ${chatErr.message}`);
        }
        
        const webhookPayload = {
          id: message.id._serialized,
          from: message.from,
          fromName: contact?.pushname || contact?.name || message.from,
          body: message.body,
          timestamp: message.timestamp,
          hasMedia: message.hasMedia,
          type: message.type,
          isGroup: chat?.isGroup || false,
          chatName: chat?.name || message.from
        };

        console.log(`📦 Payload:`);
        console.log(JSON.stringify(webhookPayload, null, 2));
        console.log(`🚀 Sending POST request...`);
        
        const response = await axios.post(webhookUrl, webhookPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        const duration = Date.now() - webhookStartTime;
        
        console.log(`✅ WEBHOOK SUCCESS [${logId}]`);
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Response Status: ${response.status}`);
        console.log(`📄 Response Data:`, response.data);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
      } catch (error) {
        const duration = Date.now() - webhookStartTime;
        
        console.error(`❌ WEBHOOK FAILED [${logId}]`);
        console.error(`⏱️  Duration: ${duration}ms`);
        console.error(`💥 Error: ${error.message}`);
        
        if (error.response) {
          console.error(`📊 Response Status: ${error.response.status}`);
          console.error(`📄 Response Data:`, error.response.data);
        } else if (error.request) {
          console.error(`📡 No response received from server`);
        }
        
        console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      }
    } else {
      console.log(`🔕 Webhook skipped: ${!webhookEnabled ? 'disabled' : 'no URL configured'}`);
    }
    } catch (handlerError) {
      console.error('💥💥💥 MESSAGE HANDLER CRASHED 💥💥💥');
      console.error('Error:', handlerError.message);
      console.error('Stack:', handlerError.stack);
      console.error('💥💥💥 END CRASH REPORT 💥💥💥\n');
    }
  });

  // Log all registered event listeners
  console.log('📋 Registered WhatsApp events:', client.eventNames());
  
  console.log('🚀 Initializing WhatsApp client...');
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
  setNoCache(res);
  const state = getEffectiveState();
  res.json({
    ready: state.ready,
    hasQR: state.hasQR,
    authenticated: !!state.lastAuthAt,
    lastQrAt: state.lastQrAt,
    lastReadyAt: state.lastReadyAt,
    lastAuthAt: state.lastAuthAt,
    lastDisconnectAt: state.lastDisconnectAt,
    lastClientState: state.lastClientState
  });
});

app.get('/api/qr', async (req, res) => {
  setNoCache(res);
  const state = getEffectiveState();
  const qrValue = state.qr;
  if (!qrValue) {
    return res.json({ qr: null });
  }
  
  try {
    const qrImage = await qrcode.toDataURL(qrValue);
    res.json({ qr: qrImage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;

  console.log(`📤 SEND REQUEST - Raw 'to': "${to}", Message: "${message?.substring(0, 50)}..."`);

  if (!isReady) {
    return res.status(400).json({ error: 'WhatsApp not ready' });
  }

  try {
    if (!to) {
      throw new Error('Phone number ("to") is required');
    }

    // Format phone number for WhatsApp
    let formattedNumber = to.replace(/\D/g, ''); // Remove non-digits
    
    console.log(`📞 Formatted number: "${formattedNumber}" (${formattedNumber.length} digits)`);

    // Validate number length (should be 10-15 digits with country code)
    if (formattedNumber.length < 10 || formattedNumber.length > 15) {
      throw new Error(`Invalid phone number: "${to}" -> "${formattedNumber}" (${formattedNumber.length} digits). Include country code (10-15 digits total)`);
    }

    // WhatsApp format: number@c.us
    const chatId = formattedNumber + '@c.us';
    
    console.log(`💬 Sending to chatId: ${chatId}`);

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
app.get('/api/webhook', async (req, res) => {
  const checkId = Math.random().toString(36).substring(2, 10).toUpperCase();
  const startTime = Date.now();
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔍 WEBHOOK CHECK [${checkId}] - STARTING`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⏰ Time: ${new Date().toISOString()}`);
  console.log(`📋 Configured URL: ${webhookUrl || 'NOT SET'}`);
  console.log(`📊 Enabled: ${webhookEnabled}`);
  
  // Basic info response
  const basicInfo = {
    enabled: webhookEnabled,
    url: webhookUrl ? webhookUrl.replace(/(?<=:\/\/).*(?=@)/, '***') : null,
    checkId: checkId,
    checkedAt: new Date().toISOString()
  };
  
  // If no webhook configured, return early
  if (!webhookUrl) {
    console.log(`⚠️  No webhook URL configured`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return res.json({
      ...basicInfo,
      status: 'NOT_CONFIGURED',
      reachable: false,
      message: 'Webhook URL is not set'
    });
  }
  
  if (!webhookEnabled) {
    console.log(`⚠️  Webhook is DISABLED`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return res.json({
      ...basicInfo,
      status: 'DISABLED',
      reachable: false,
      message: 'Webhook is disabled'
    });
  }
  
  // Actually test the webhook with a test message
  console.log(`🧪 Testing webhook with message schema...`);
  
  try {
    // Send a test payload that matches the actual WhatsApp message schema
    const testPayload = {
      id: `test_${checkId}`,
      from: 'test@c.us',
      fromName: 'Webhook Test',
      body: `[TEST] Webhook connectivity check - ID: ${checkId}`,
      timestamp: Math.floor(Date.now() / 1000),
      hasMedia: false,
      type: 'chat',
      isGroup: false,
      chatName: 'Webhook Test',
      _test: true,
      _checkId: checkId
    };
    
    const response = await axios.post(webhookUrl, testPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true // Accept any status code
    });
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ WEBHOOK CHECK SUCCESS [${checkId}]`);
    console.log(`⏱️  Response Time: ${duration}ms`);
    console.log(`📊 Status Code: ${response.status}`);
    console.log(`📄 Response:`, response.data);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Determine health based on status code
    const isHealthy = response.status >= 200 && response.status < 300;
    
    res.json({
      ...basicInfo,
      status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
      reachable: true,
      healthy: isHealthy,
      responseTime: `${duration}ms`,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      responsePreview: response.data,
      message: isHealthy ? 'Webhook is working correctly' : `Webhook returned ${response.status}`
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error(`❌ WEBHOOK CHECK FAILED [${checkId}]`);
    console.error(`⏱️  Duration: ${duration}ms`);
    console.error(`💥 Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error(`🔌 Connection refused - server not running`);
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      console.error(`⏰ Request timed out`);
    } else if (error.code === 'ENOTFOUND') {
      console.error(`🌐 DNS lookup failed - domain not found`);
    }
    
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    res.json({
      ...basicInfo,
      status: 'UNREACHABLE',
      reachable: false,
      healthy: false,
      responseTime: `${duration}ms`,
      error: error.message,
      errorCode: error.code,
      message: `Webhook unreachable: ${error.message}`
    });
  }
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
  
  // Save to disk so it persists after restart
  saveWebhookConfig();
  
  console.log('✅ Webhook configured and saved:', url);
  
  res.json({
    success: true,
    enabled: webhookEnabled,
    url: webhookUrl.replace(/(?<=:\/\/).*(?=@)/, '***')
  });
});

app.delete('/api/webhook', (req, res) => {
  webhookEnabled = false;
  saveWebhookConfig(); // Persist the disabled state
  console.log('🔕 Webhook disabled and saved');
  
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

/**
 * Example Webhook Server
 * 
 * This is a simple webhook receiver that you can use to test
 * incoming WhatsApp messages from your API.
 * 
 * Usage:
 * 1. Run this server: node webhook-example.js
 * 2. Expose it publicly using ngrok: ngrok http 3000
 * 3. Configure the ngrok URL in your WhatsApp API dashboard
 * 4. Send a message to your WhatsApp number
 */

const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const message = req.body;
  
  console.log('\n📨 New Message Received!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('From:', message.fromName);
  console.log('Number:', message.from);
  console.log('Message:', message.body);
  console.log('Time:', new Date(message.timestamp * 1000).toLocaleString());
  console.log('Type:', message.type);
  console.log('Is Group:', message.isGroup);
  console.log('Has Media:', message.hasMedia);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Add your custom logic here:
  // - Save to database
  // - Send notifications
  // - Auto-reply
  // - Forward to other services
  // - Trigger workflows
  
  // Example: Auto-reply logic
  if (message.body.toLowerCase().includes('hello')) {
    console.log('💡 Tip: You could auto-reply here by calling /api/send');
  }
  
  // Always respond with success
  res.json({ 
    success: true,
    received: true,
    timestamp: Date.now()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'WhatsApp Webhook Receiver',
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <h1>WhatsApp Webhook Receiver</h1>
    <p>Server is running and ready to receive webhooks!</p>
    <p>POST your webhooks to: <code>/webhook</code></p>
    <p>Health check: <code>/health</code></p>
  `);
});

app.listen(PORT, () => {
  console.log('🚀 Webhook server started!');
  console.log(`📡 Listening on http://localhost:${PORT}`);
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log('\n💡 To expose this publicly, use ngrok:');
  console.log(`   ngrok http ${PORT}`);
  console.log('\nWaiting for incoming messages...\n');
});

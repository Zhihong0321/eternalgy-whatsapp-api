const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./logger');
const database = require('./database');
const whatsappClient = require('./whatsapp-client');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Logging middleware
app.use((req, res, next) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  next();
});

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Status endpoint
app.get('/api/status', (req, res) => {
  try {
    const status = whatsappClient.getStatus();
    logger.info('Status requested', status);
    res.json({
      success: true,
      ...status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      timestamp: new Date().toISOString()
    });
  }
});

// QR Code endpoint
app.get('/api/qr', (req, res) => {
  try {
    const qrCode = whatsappClient.getQrCode();
    if (qrCode) {
      res.json({
        success: true,
        qrCode,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        success: false,
        message: 'QR code not available',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Failed to get QR code', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get QR code',
      timestamp: new Date().toISOString()
    });
  }
});

// Send message endpoint
app.post('/api/send', async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, message'
      });
    }

    logger.info('Send message request', { to, messageLength: message.length });

    const result = await whatsappClient.sendMessage(to, message);
    
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to send message', { 
      error: error.message,
      to: req.body.to 
    });
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Configure webhook endpoint
app.post('/api/webhook/config', async (req, res) => {
  try {
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: webhookUrl'
      });
    }

    await database.setWebhookUrl(webhookUrl);
    
    logger.info('Webhook URL configured', { 
      webhookUrl: webhookUrl.substring(0, 50) + '...' 
    });

    res.json({
      success: true,
      message: 'Webhook URL configured successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to configure webhook', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get webhook configuration
app.get('/api/webhook/config', async (req, res) => {
  try {
    const webhookUrl = await database.getWebhookUrl();
    res.json({
      success: true,
      webhookUrl,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get webhook config', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Documentation
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'WhatsApp API Server',
    version: '1.0.0',
    description: 'WhatsApp Web API for ERP integration',
    endpoints: {
      'GET /api/status': 'Get WhatsApp connection status',
      'GET /api/qr': 'Get QR code for device linking',
      'POST /api/send': 'Send WhatsApp message { to, message }',
      'POST /api/webhook/config': 'Configure webhook URL { webhookUrl }',
      'GET /api/webhook/config': 'Get current webhook configuration'
    },
    examples: {
      sendMessage: {
        method: 'POST',
        url: '/api/send',
        body: {
          to: '+1234567890',
          message: 'Hello from API!'
        }
      },
      configureWebhook: {
        method: 'POST',
        url: '/api/webhook/config',
        body: {
          webhookUrl: 'https://your-erp.com/webhook'
        }
      }
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: new Date().toISOString()
  });
});

// Initialize server
async function startServer() {
  try {
    logger.info('Starting WhatsApp API Server...', {
      port: PORT,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    });

    // Initialize database
    await database.connect();
    logger.info('Database connected successfully');

    // Initialize WhatsApp client
    await whatsappClient.initialize();
    logger.info('WhatsApp client initialized');

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        dashboardUrl: `http://localhost:${PORT}`,
        apiDocsUrl: `http://localhost:${PORT}/api/docs`
      });
    });

  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    await whatsappClient.destroy();
    await database.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await whatsappClient.destroy();
    await database.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

// Start the server
startServer();
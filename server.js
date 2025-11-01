const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const winston = require('winston');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'your-secret-api-key';

// Import WhatsApp client module (single client only)
let whatsappClient = null;
let database = null;

try {
  whatsappClient = require('./whatsapp-client');
} catch (e) {
  console.warn('Failed to load whatsapp-client module:', e.message);
}

try {
  database = require('./database');
} catch (e) {
  console.warn('Failed to load database module:', e.message);
}

// Use existing logger from logger.js module
// If logger.js doesn't exist, fallback to winston
let logInstance;
try {
  logInstance = require('./logger');
} catch (e) {
  logInstance = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' }),
      new winston.transports.Console({ format: winston.format.simple() })
    ]
  });
}
const logger = logInstance;

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Authentication middleware (optional - only if API_KEY is set)
const checkAuthToken = (req, res, next) => {
  if (API_KEY && API_KEY !== 'your-secret-api-key') {
    const token = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!token || token !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
  }
  next();
};

// Routes

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Documentation
app.get('/api/docs', (req, res) => {
  res.json({
    "WhatsApp API Documentation": {
      "description": "Single WhatsApp client API",
      "endpoints": {
        "GET /api/status": {
          "description": "Get WhatsApp connection status",
          "response": "{ \"status\": \"connected|waiting_qr|disconnected\", \"phoneNumber\": \"...\", \"sessionId\": \"main_session\", \"hasQrCode\": true/false }"
        },
        "GET /api/qr": {
          "description": "Get QR code for WhatsApp authentication",
          "response": "{ \"success\": true, \"qrCode\": \"data:image/png;base64...\" }"
        },
        "POST /api/send": {
          "description": "Send a WhatsApp message",
          "body": "{ \"to\": \"1234567890@c.us\", \"message\": \"Hello World\" }",
          "response": "{ \"success\": true, \"messageId\": \"...\", \"timestamp\": \"...\" }"
        },
        "POST /api/webhook/config": {
          "description": "Configure webhook URL for incoming messages",
          "body": "{ \"webhookUrl\": \"https://your-webhook.com\" }",
          "response": "{ \"success\": true, \"message\": \"Webhook URL configured\" }"
        },
        "GET /api/webhook/config": {
          "description": "Get current webhook configuration",
          "response": "{ \"success\": true, \"webhookUrl\": \"...\" }"
        },
        "POST /api/logout": {
          "description": "Logout and reset WhatsApp session",
          "response": "{ \"success\": true, \"message\": \"Session cleared\" }"
        }
      }
    }
  });
});

// Get WhatsApp status
app.get('/api/status', async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp client not available',
        timestamp: new Date().toISOString()
      });
    }
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

// Get QR code
app.get('/api/qr', async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp client not available',
        timestamp: new Date().toISOString()
      });
    }
    logger.info('QR code requested');
    const qrCode = await whatsappClient.getQrCode();
    if (qrCode) {
      logger.info('Sending QR code to client');
      res.json({
        success: true,
        qrCode,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn('QR code not available');
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

// Send message
app.post('/api/send', checkAuthToken, async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp client not available',
        timestamp: new Date().toISOString()
      });
    }
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
app.post('/api/webhook/config', checkAuthToken, async (req, res) => {
  try {
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: webhookUrl'
      });
    }

    if (database && database.setWebhookUrl) {
      await database.setWebhookUrl(webhookUrl);
    }
    
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
app.get('/api/webhook/config', checkAuthToken, async (req, res) => {
  try {
    let webhookUrl = null;
    if (database && database.getWebhookUrl) {
      webhookUrl = await database.getWebhookUrl();
    }
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

// Logout and reset session
app.post('/api/logout', checkAuthToken, async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp client not available',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Logout requested');
    await whatsappClient.logout();

    res.json({
      success: true,
      message: 'Session cleared and client reinitialized',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to logout', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize WhatsApp client on startup
async function startServer() {
  // Start server first to make healthcheck available immediately
  const server = app.listen(PORT, () => {
    logger.info(`WhatsApp API Server running on port ${PORT}`);
    logger.info(`Dashboard available at: http://localhost:${PORT}`);
    logger.info(`API Documentation: http://localhost:${PORT}/api/docs`);
    if (API_KEY && API_KEY !== 'your-secret-api-key') {
      logger.info(`API Key configured: ${API_KEY.substring(0, 10)}...`);
    }
  });

  // Initialize database if available (non-blocking)
  if (database && database.connect) {
    try {
      await database.connect();
      logger.info('Database connected successfully');
    } catch (dbError) {
      logger.warn('Database connection failed, continuing without database', { error: dbError.message });
    }
  } else {
    logger.warn('Database module not available, continuing without database');
  }

  // Initialize WhatsApp client (non-blocking)
  if (whatsappClient && whatsappClient.initialize) {
    try {
      logger.info('Starting WhatsApp client initialization...');
      await whatsappClient.initialize();
      logger.info('WhatsApp client initialized successfully');
    } catch (waError) {
      logger.error('Failed to initialize WhatsApp client', { 
        error: waError.message,
        stack: waError.stack 
      });
      // Continue anyway - client can be initialized later
    }
  } else {
    logger.error('WhatsApp client module not available - check logs for module load errors');
  }

  return server;
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    if (whatsappClient && whatsappClient.destroy) {
      await whatsappClient.destroy();
    }
    if (database && database.close) {
      await database.close();
    }
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
    if (whatsappClient && whatsappClient.destroy) {
      await whatsappClient.destroy();
    }
    if (database && database.close) {
      await database.close();
    }
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Don't exit, let the server keep running
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, let the server keep running
});

// Start the server
startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

// Optional dependencies - handle gracefully if missing
let database = null;
let axios = null;

try {
  database = require('./database');
} catch (e) {
  logger.warn('Database module not available, continuing without database persistence');
}

try {
  axios = require('axios');
} catch (e) {
  logger.warn('Axios not available, webhook functionality will be limited');
}

// Required for RemoteAuth
class WhatsAppAPIDatabaseStore {
    constructor(db) {
        this.db = db;
    }

    async sessionExists(session) {
        return await this.db.getSession(session) !== null;
    }

    async save(data) {
        await this.db.saveSession(data.session, data.session);
    }

    async extract(session) {
        return await this.db.getSession(session);
    }

    async delete(session) {
        await this.db.deleteSession(session);
    }
}


class WhatsAppManager {
  constructor() {
    this.client = null;
    this.sessionId = 'main_session';
    this.status = 'disconnected';
    this.qrCode = null;
    this.phoneNumber = null;
    this.isInitializing = false;
    this.keepAliveInterval = null;
    this.handlersSetup = false; // Track if event handlers are already set up
    this.store = database ? new WhatsAppAPIDatabaseStore(database) : null;
  }

  async initialize() {
    // Prevent multiple simultaneous initializations
    if (this.isInitializing) {
      logger.warn('WhatsApp client already initializing');
      return;
    }

    // If client is already connected, don't reinitialize
    if (this.client && this.status === 'connected') {
      logger.info('WhatsApp client already connected, skipping initialization');
      return;
    }

    // Clean up existing client before creating new one
    if (this.client) {
      logger.info('Cleaning up existing client before reinitializing...');
      try {
        this.stopKeepAlive();
        // Remove all event listeners by destroying the client
        await this.client.destroy();
      } catch (error) {
        logger.warn('Error destroying existing client:', { error: error.message });
      }
      this.client = null;
      this.handlersSetup = false;
    }

    this.isInitializing = true;
    logger.info('Initializing WhatsApp client', { sessionId: this.sessionId });

    try {
      
      this.client = new Client({
        authStrategy: new RemoteAuth({
            clientId: this.sessionId,
            store: this.store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
          headless: true,
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
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows'
          ],
          executablePath: process.env.CHROME_PATH || undefined,
          ignoreDefaultArgs: ['--enable-automation']
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2413.51-beta.html'
        }
      });

      // Setup event handlers BEFORE initializing
      this.setupEventHandlers();
      
      await this.client.initialize();
      logger.info('WhatsApp client initialization started');
      
    } catch (error) {
      this.isInitializing = false;
      this.client = null;
      this.handlersSetup = false;
      logger.error('Failed to initialize WhatsApp client', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  setupEventHandlers() {
    // Prevent duplicate handler registration
    if (this.handlersSetup && this.client) {
      logger.warn('Event handlers already set up, skipping duplicate setup', {
        sessionId: this.sessionId,
        clientExists: !!this.client
      });
      return;
    }
    
    // Only set up handlers if client exists
    if (!this.client) {
      logger.error('Cannot setup event handlers: client is null');
      return;
    }

    logger.info('Setting up event handlers', { sessionId: this.sessionId });
    this.handlersSetup = true;

    this.client.on('qr', async (qr) => {
      logger.info('QR Code received', { sessionId: this.sessionId });
      this.qrCode = qr; // Store raw QR string immediately to prevent race condition
      this.status = 'waiting_qr';

      if (database && database.updateSessionStatus) {
        try {
          await database.updateSessionStatus(this.sessionId, 'waiting_qr');
        } catch (dbError) {
          logger.warn('Failed to update session status in database', { error: dbError.message });
        }
      }
      logger.info('QR code stored and status updated');
    });

    this.client.on('authenticated', async (session) => {
      logger.info('WhatsApp client authenticated', { sessionId: this.sessionId });
      this.status = 'authenticated';
      if (database && database.saveSession) {
        try {
          await database.saveSession(this.sessionId, session, 'authenticated');
        } catch (dbError) {
          logger.warn('Failed to save session to database', { error: dbError.message });
        }
      }
    });

    this.client.on('auth_failure', async (msg) => {
      logger.error('Authentication failed', { message: msg, sessionId: this.sessionId });
      this.status = 'auth_failed';
      if (database && database.updateSessionStatus) {
        try {
          await database.updateSessionStatus(this.sessionId, 'auth_failed');
        } catch (dbError) {
          logger.warn('Failed to update session status in database', { error: dbError.message });
        }
      }
      this.qrCode = null;
    });

    this.client.on('ready', async () => {
      this.isInitializing = false;
      this.status = 'connected';
      this.phoneNumber = this.client.info?.wid?.user || null;
      
      logger.info('WhatsApp client ready', { 
        sessionId: this.sessionId,
        phoneNumber: this.phoneNumber 
      });
      
      if (database && database.updateSessionStatus) {
        try {
          await database.updateSessionStatus(this.sessionId, 'connected', this.phoneNumber);
        } catch (dbError) {
          logger.warn('Failed to update session status in database', { error: dbError.message });
        }
      }
      this.qrCode = null;
      
      // Set up keep-alive mechanism
      this.startKeepAlive();
    });

    this.client.on('disconnected', async (reason) => {
      logger.warn('WhatsApp client disconnected', { 
        reason, 
        sessionId: this.sessionId,
        currentStatus: this.status
      });
      
      // Only process disconnect if we're actually connected
      if (this.status !== 'connected' && this.status !== 'authenticated') {
        logger.debug('Ignoring disconnect event - client not in connected state', { 
          currentStatus: this.status 
        });
        return;
      }
      
      this.stopKeepAlive();
      this.status = 'disconnected';
      this.phoneNumber = null;
      this.qrCode = null;
      this.isInitializing = false;
      this.handlersSetup = false;
      
      if (database && database.updateSessionStatus) {
        try {
          await database.updateSessionStatus(this.sessionId, 'disconnected');
        } catch (dbError) {
          logger.warn('Failed to update session status in database', { error: dbError.message });
        }
      }
      
      // Auto-reconnect after a delay if not manually destroyed and not already initializing
      if (reason !== 'NAVIGATION' && reason !== 'LOGOUT') {
        logger.info('Scheduling auto-reconnect in 5 seconds...', { reason });
        setTimeout(async () => {
          // Double-check conditions before reconnecting
          if (this.status === 'disconnected' && !this.isInitializing && !this.client) {
            logger.info('Attempting auto-reconnect...');
            try {
              await this.initialize();
            } catch (error) {
              logger.error('Auto-reconnect failed', { error: error.message });
            }
          } else {
            logger.debug('Skipping auto-reconnect - conditions not met', {
              status: this.status,
              isInitializing: this.isInitializing,
              hasClient: !!this.client
            });
          }
        }, 5000);
      } else {
        logger.info('Not auto-reconnecting due to reason:', reason);
      }
    });

    this.client.on('message', async (message) => {
      logger.info('Message received', {
        from: message.from,
        type: message.type,
        hasMedia: message.hasMedia,
        timestamp: message.timestamp
      });

      await this.handleIncomingMessage(message);
    });

    this.client.on('message_create', async (message) => {
      if (message.fromMe) {
        logger.info('Message sent', {
          to: message.to,
          type: message.type,
          timestamp: message.timestamp
        });
      }
    });
  }

  async handleIncomingMessage(message) {
    try {
      let webhookUrl = null;
      if (database && database.getWebhookUrl) {
        try {
          webhookUrl = await database.getWebhookUrl();
        } catch (dbError) {
          logger.warn('Failed to get webhook URL from database', { error: dbError.message });
        }
      }
      
      if (!webhookUrl) {
        logger.warn('No webhook URL configured, skipping message forwarding');
        return;
      }

      const messageData = {
        id: message.id._serialized,
        from: message.from,
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        hasMedia: message.hasMedia,
        contact: {
          name: message._data.notifyName || 'Unknown',
          number: message.from.replace('@c.us', '')
        }
      };

      logger.info('Forwarding message to webhook', {
        webhookUrl: webhookUrl.substring(0, 50) + '...',
        messageId: messageData.id,
        from: messageData.from
      });

      if (!axios) {
        logger.warn('Axios not available, cannot send webhook');
        return;
      }

      const response = await axios.post(webhookUrl, messageData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-API-Server/1.0'
        }
      });

      logger.info('Webhook delivered successfully', {
        status: response.status,
        messageId: messageData.id
      });

    } catch (error) {
      logger.error('Failed to forward message to webhook', {
        error: error.message,
        messageId: message.id._serialized
      });
    }
  }

  async sendMessage(to, message) {
    try {
      if (this.status !== 'connected') {
        throw new Error(`Cannot send message, client status: ${this.status}`);
      }

      logger.info('Sending message', { to, messageLength: message.length });

      let phoneNumber = to;
      if (!phoneNumber.includes('@c.us')) {
        phoneNumber = phoneNumber.replace(/[^\d]/g, '') + '@c.us';
      }

      const sentMessage = await this.client.sendMessage(phoneNumber, message);
      
      logger.info('Message sent successfully', {
        to: phoneNumber,
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp
      });

      return {
        success: true,
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
        to: phoneNumber
      };

    } catch (error) {
      logger.error('Failed to send message', {
        to,
        error: error.message
      });
      throw error;
    }
  }

  getStatus() {
    return {
      status: this.status,
      phoneNumber: this.phoneNumber,
      sessionId: this.sessionId,
      hasQrCode: !!this.qrCode,
      isInitializing: this.isInitializing
    };
  }

  async getQrCode() {
    if (!this.qrCode) {
      return null;
    }
    try {
      return await qrcode.toDataURL(this.qrCode);
    } catch (err) {
      logger.error('Failed to generate QR code data URL', { error: err.message });
      return null;
    }
  }

  startKeepAlive() {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    
    // Only start keep-alive if client is connected
    if (this.status !== 'connected' || !this.client) {
      logger.debug('Skipping keep-alive start - client not connected');
      return;
    }
    
    logger.info('Starting keep-alive mechanism');
    
    // Send a keep-alive message every 30 seconds to maintain connection
    this.keepAliveInterval = setInterval(async () => {
      // Check if client is still valid and connected
      if (this.status !== 'connected' || !this.client) {
        logger.debug('Keep-alive: stopping - client not connected');
        this.stopKeepAlive();
        return;
      }

      try {
        // Simple check to verify client is still alive
        // Using a lightweight operation that won't cause issues
        if (this.client.info && this.client.info.wid) {
          logger.debug('Keep-alive check successful', { 
            phoneNumber: this.client.info.wid.user,
            status: 'connected' 
          });
        }
      } catch (error) {
        logger.warn('Keep-alive check failed', { 
          error: error.message,
          errorType: error.constructor.name 
        });
        
        // If keep-alive fails with connection errors, mark as disconnected
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('session closed') || 
            errorMsg.includes('disconnected') ||
            errorMsg.includes('not connected') ||
            errorMsg.includes('destroyed')) {
          logger.warn('Connection appears lost, stopping keep-alive');
          this.stopKeepAlive();
          // Don't manually disconnect here - let the client handle it
        }
      }
    }, 30000); // 30 seconds
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  async destroy() {
    try {
      logger.info('Destroying WhatsApp client...');
      this.stopKeepAlive();
      this.isInitializing = false;
      
      if (this.client) {
        try {
          await this.client.destroy();
          logger.info('WhatsApp client destroyed successfully');
        } catch (destroyError) {
          logger.warn('Error during client destroy', { error: destroyError.message });
        }
      }
      
      this.client = null;
      this.status = 'disconnected';
      this.phoneNumber = null;
      this.qrCode = null;
      this.handlersSetup = false;
    } catch (error) {
      logger.error('Error destroying WhatsApp client', { error: error.message });
      // Reset state even if destroy fails
      this.client = null;
      this.status = 'disconnected';
      this.isInitializing = false;
      this.handlersSetup = false;
    }
  }

  async logout() {
    try {
      logger.info('Logging out WhatsApp client');

      if (this.client) {
        await this.client.logout();
        await this.client.destroy();
      }

      this.status = 'disconnected';
      this.phoneNumber = null;
      this.qrCode = null;
      this.isInitializing = false;
      this.handlersSetup = false;

      if (database && database.deleteSession) {
        try {
          await database.deleteSession(this.sessionId);
        } catch (dbError) {
          logger.warn('Failed to delete session from database', { error: dbError.message });
        }
      }
      logger.info('WhatsApp client logged out and session cleared');

      // Reinitialize
      await this.initialize();

    } catch (error) {
      logger.error('Error logging out WhatsApp client', { error: error.message });
      throw error;
    }
  }
}

module.exports = new WhatsAppManager();
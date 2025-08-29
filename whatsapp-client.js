const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const database = require('./database');

class WhatsAppManager {
  constructor() {
    this.client = null;
    this.sessionId = 'main_session';
    this.status = 'disconnected';
    this.qrCode = null;
    this.phoneNumber = null;
    this.isInitializing = false;
  }

  async initialize() {
    if (this.isInitializing) {
      logger.warn('WhatsApp client already initializing');
      return;
    }

    this.isInitializing = true;
    logger.info('Initializing WhatsApp client', { sessionId: this.sessionId });

    try {
      const savedSession = await database.getSession(this.sessionId);
      
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.sessionId,
          dataPath: './sessions/'
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
            '--disable-gpu'
          ]
        }
      });

      this.setupEventHandlers();
      
      await this.client.initialize();
      logger.info('WhatsApp client initialization started');
      
    } catch (error) {
      this.isInitializing = false;
      logger.error('Failed to initialize WhatsApp client', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  setupEventHandlers() {
    this.client.on('qr', async (qr) => {
      logger.info('QR Code received', { sessionId: this.sessionId });
      try {
        this.qrCode = await qrcode.toDataURL(qr);
        this.status = 'waiting_qr';
        await database.updateSessionStatus(this.sessionId, 'waiting_qr');
        logger.info('QR code generated and status updated');
      } catch (error) {
        logger.error('Failed to generate QR code', { error: error.message });
      }
    });

    this.client.on('authenticated', async (session) => {
      logger.info('WhatsApp client authenticated', { sessionId: this.sessionId });
      this.status = 'authenticated';
      await database.saveSession(this.sessionId, session, 'authenticated');
    });

    this.client.on('auth_failure', async (msg) => {
      logger.error('Authentication failed', { message: msg, sessionId: this.sessionId });
      this.status = 'auth_failed';
      await database.updateSessionStatus(this.sessionId, 'auth_failed');
      this.qrCode = null;
    });

    this.client.on('ready', async () => {
      this.isInitializing = false;
      this.status = 'connected';
      this.phoneNumber = this.client.info.wid.user;
      
      logger.info('WhatsApp client ready', { 
        sessionId: this.sessionId,
        phoneNumber: this.phoneNumber 
      });
      
      await database.updateSessionStatus(this.sessionId, 'connected', this.phoneNumber);
      this.qrCode = null;
    });

    this.client.on('disconnected', async (reason) => {
      logger.warn('WhatsApp client disconnected', { 
        reason, 
        sessionId: this.sessionId 
      });
      this.status = 'disconnected';
      this.phoneNumber = null;
      this.qrCode = null;
      await database.updateSessionStatus(this.sessionId, 'disconnected');
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
      const webhookUrl = await database.getWebhookUrl();
      
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

  getQrCode() {
    return this.qrCode;
  }

  async destroy() {
    try {
      if (this.client) {
        await this.client.destroy();
        logger.info('WhatsApp client destroyed');
      }
    } catch (error) {
      logger.error('Error destroying WhatsApp client', { error: error.message });
    }
  }
}

module.exports = new WhatsAppManager();
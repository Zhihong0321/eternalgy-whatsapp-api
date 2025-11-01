const { Pool } = require('pg');
const logger = require('./logger');

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async connect() {
    if (!process.env.DATABASE_URL) {
      logger.warn('DATABASE_URL environment variable not set. Database functionality will be disabled.');
      this.isConnected = false;
      return;
    }

    try {
      const connectionConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      };

      this.pool = new Pool(connectionConfig);
      
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.isConnected = true;
      logger.info('Database connected successfully', {
        host: connectionConfig.connectionString ? '[REDACTED]' : 'localhost',
        ssl: !!connectionConfig.ssl
      });

      await this.initializeTables();
    } catch (error) {
      this.isConnected = false;
      logger.error('Database connection failed', { 
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async initializeTables() {
    if (!this.isConnected) return;
    const createSessionTable = `
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        session_data TEXT,
        status VARCHAR(50) DEFAULT 'waiting_qr',
        phone_number VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createWebhookConfigTable = `
      CREATE TABLE IF NOT EXISTS webhook_config (
        id SERIAL PRIMARY KEY,
        webhook_url VARCHAR(500),
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await this.pool.query(createSessionTable);
      await this.pool.query(createWebhookConfigTable);
      logger.info('Database tables initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database tables', {
        error: error.message
      });
      throw error;
    }
  }

  async saveSession(sessionId, sessionData, status = 'waiting_qr') {
    if (!this.isConnected) return;
    try {
      const query = `
        INSERT INTO whatsapp_sessions (session_id, session_data, status, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (session_id) 
        DO UPDATE SET session_data = $2, status = $3, updated_at = CURRENT_TIMESTAMP
      `;
      await this.pool.query(query, [sessionId, JSON.stringify(sessionData), status]);
      logger.info('Session saved to database', { sessionId, status });
    } catch (error) {
      logger.error('Failed to save session', { 
        sessionId, 
        error: error.message 
      });
      throw error;
    }
  }

  async getSession(sessionId) {
    if (!this.isConnected) return null;
    try {
      const query = 'SELECT * FROM whatsapp_sessions WHERE session_id = $1';
      const result = await this.pool.query(query, [sessionId]);
      
      if (result.rows.length > 0) {
        const session = result.rows[0];
        logger.info('Session retrieved from database', { 
          sessionId, 
          status: session.status 
        });
        return {
          ...session,
          session_data: session.session_data ? JSON.parse(session.session_data) : null
        };
      }
      return null;
    } catch (error) {
      logger.error('Failed to retrieve session', { 
        sessionId, 
        error: error.message 
      });
      throw error;
    }
  }

  async updateSessionStatus(sessionId, status, phoneNumber = null) {
    if (!this.isConnected) return;
    try {
      const query = `
        UPDATE whatsapp_sessions 
        SET status = $1, phone_number = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE session_id = $3
      `;
      await this.pool.query(query, [status, phoneNumber, sessionId]);
      logger.info('Session status updated', { sessionId, status, phoneNumber });
    } catch (error) {
      logger.error('Failed to update session status', { 
        sessionId, 
        status, 
        error: error.message 
      });
      throw error;
    }
  }

  async setWebhookUrl(url) {
    if (!this.isConnected) return;
    try {
      const query = `
        INSERT INTO webhook_config (webhook_url, is_active, updated_at)
        VALUES ($1, true, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET webhook_url = $1, is_active = true, updated_at = CURRENT_TIMESTAMP
      `;
      await this.pool.query(query, [url]);
      logger.info('Webhook URL configured', { url: url.substring(0, 50) + '...' });
    } catch (error) {
      logger.error('Failed to set webhook URL', { error: error.message });
      throw error;
    }
  }

  async getWebhookUrl() {
    if (!this.isConnected) return null;
    try {
      const query = 'SELECT webhook_url FROM webhook_config WHERE is_active = true LIMIT 1';
      const result = await this.pool.query(query);
      return result.rows.length > 0 ? result.rows[0].webhook_url : null;
    } catch (error) {
      logger.error('Failed to get webhook URL', { error: error.message });
      return null;
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected) return;
    try {
      const query = 'DELETE FROM whatsapp_sessions WHERE session_id = $1';
      await this.pool.query(query, [sessionId]);
      logger.info('Session deleted from database', { sessionId });
    } catch (error) {
      logger.error('Failed to delete session', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  async close() {
    if (this.isConnected && this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }
}

module.exports = new DatabaseManager();
const { Pool } = require('pg');
const { Store } = require('whatsapp-web.js');

// Get database configuration
const connectionString = process.env.DATABASE_URL;
const tablePrefix = process.env.DB_PREFIX || 'wa';
const tableName = `${tablePrefix}_sessions`;

// Initialize Postgres Pool
const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class PostgresStore extends Store {
    constructor() {
        super();
        this.pool = pool;
        this.tableName = tableName;
        this.init();
    }

    async init() {
        console.log(`Checking table ${this.tableName} existence...`);
        const query = `
            CREATE TABLE IF NOT EXISTS "${this.tableName}" (
                session_id VARCHAR(255) PRIMARY KEY,
                data TEXT NOT NULL
            );
        `;
        try {
            await this.pool.query(query);
            console.log(`✅ Table "${this.tableName}" is ready.`);
        } catch (err) {
            console.error(`❌ Failed to create table "${this.tableName}":`, err);
        }
    }

    async sessionExists(options) {
        const { session } = options;
        try {
            const result = await this.pool.query(
                `SELECT 1 FROM "${this.tableName}" WHERE session_id = $1`,
                [session]
            );
            return result.rowCount > 0;
        } catch (err) {
            console.error('Check session error:', err);
            return false;
        }
    }

    async save(options) {
        const { session, data } = options; // session is just the name/ID, data is the JSON object
        try {
            // Upsert logic
            await this.pool.query(
                `INSERT INTO "${this.tableName}" (session_id, data) 
                 VALUES ($1, $2)
                 ON CONFLICT (session_id) 
                 DO UPDATE SET data = $2`,
                [session, JSON.stringify(data)]
            );
            console.log(`Saved session: ${session}`);
        } catch (err) {
            console.error('Save session error:', err);
        }
    }

    async extract(options) {
        const { session } = options;
        try {
            const result = await this.pool.query(
                `SELECT data FROM "${this.tableName}" WHERE session_id = $1`,
                [session]
            );
            if (result.rowCount > 0) {
                return JSON.parse(result.rows[0].data);
            }
            return null;
        } catch (err) {
            console.error('Extract session error:', err);
            return null;
        }
    }

    async delete(options) {
        const { session } = options;
        try {
            await this.pool.query(
                `DELETE FROM "${this.tableName}" WHERE session_id = $1`,
                [session]
            );
            console.log(`Deleted session: ${session}`);
        } catch (err) {
            console.error('Delete session error:', err);
        }
    }
}

// Only export if DATABASE_URL is present, otherwise returns null which can be handled in server.js
let store = null;
if (connectionString) {
    store = new PostgresStore();
} else {
    console.warn('⚠️ DATABASE_URL not set. PostgresStore not initialized.');
}

module.exports = {
    pool,
    store
};

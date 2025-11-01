const { Pool } = require('pg');

class PostgresStore {
    constructor() {
        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });
            this.init();
        } catch (error) {
            console.error('Failed to connect to the database:', error);
            throw error; // re-throw the error to halt initialization
        }
    }

    async init() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS wweb_sessions (
                session_key VARCHAR(255) PRIMARY KEY,
                session_data TEXT
            );
        `);
    }

    async save(options) {
        const { session, data } = options;
        await this.pool.query(
            'INSERT INTO wweb_sessions (session_key, session_data) VALUES ($1, $2) ON CONFLICT (session_key) DO UPDATE SET session_data = $2',
            [session, JSON.stringify(data)]
        );
    }

    async extract(options) {
        const { session } = options;
        const result = await this.pool.query('SELECT session_data FROM wweb_sessions WHERE session_key = $1', [session]);
        if (result.rows.length === 0) {
            return null;
        }

        try {
            return JSON.parse(result.rows[0].session_data);
        } catch (error) {
            console.error('Failed to parse session data, deleting corrupted session:', error);
            await this.delete(options);
            return null;
        }
    }

    async delete(options) {
        const { session } = options;
        await this.pool.query('DELETE FROM wweb_sessions WHERE session_key = $1', [session]);
    }

    async sessionExists(options) {
        const { session } = options;
        const result = await this.pool.query('SELECT 1 FROM wweb_sessions WHERE session_key = $1', [session]);
        return result.rowCount > 0;
    }

    async checkConnection() {
        try {
            await this.pool.query('SELECT 1');
            return true;
        } catch (error) {
            console.error('Database connection check failed:', error);
            return false;
        }
    }
}

module.exports = PostgresStore;
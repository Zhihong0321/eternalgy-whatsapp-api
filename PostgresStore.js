const { Pool } = require('pg');
const fs = require('fs');

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
                session_data BYTEA
            );
        `);
    }

    async save(options) {
        const { session } = options;
        const sessionFilePath = `${session}.zip`;
        
        try {
            const fileBuffer = fs.readFileSync(sessionFilePath);
            await this.pool.query(
                'INSERT INTO wweb_sessions (session_key, session_data) VALUES ($1, $2) ON CONFLICT (session_key) DO UPDATE SET session_data = $2',
                [session, fileBuffer]
            );
        } finally {
            if (fs.existsSync(sessionFilePath)) {
                fs.unlinkSync(sessionFilePath); // Clean up the zip file
            }
        }
    }

    async extract(options) {
        const { session, path } = options;
        const result = await this.pool.query('SELECT session_data FROM wweb_sessions WHERE session_key = $1', [session]);

        if (result.rows.length === 0 || !result.rows[0].session_data) {
            return null;
        }

        fs.writeFileSync(path, result.rows[0].session_data);
        return null;
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
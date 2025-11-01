const { Pool } = require('pg');

class PostgresStore {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        this.pool.query(`
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

    async get(options) {
        const { session } = options;
        const result = await this.pool.query('SELECT session_data FROM wweb_sessions WHERE session_key = $1', [session]);
        return result.rows[0] ? JSON.parse(result.rows[0].session_data) : null;
    }

    async delete(options) {
        const { session } = options;
        await this.pool.query('DELETE FROM wweb_sessions WHERE session_key = $1', [session]);
    }
}

module.exports = PostgresStore;
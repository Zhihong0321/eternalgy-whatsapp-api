const { Pool } = require('pg');
const { Store } = require('whatsapp-web.js');

// Simple prefix: Use DB_PREFIX or RAILWAY_SERVICE_NAME, default to 'wa'
const prefix = (process.env.DB_PREFIX || process.env.RAILWAY_SERVICE_NAME || 'wa')
    .replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize for SQL
const tableName = `${prefix}_sessions`;

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

class PostgresStore extends Store {
    async init() {
        await pool.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (id TEXT PRIMARY KEY, data TEXT)`);
    }
    async sessionExists(opt) {
        const res = await pool.query(`SELECT 1 FROM "${tableName}" WHERE id = $1`, [opt.session]);
        return res.rowCount > 0;
    }
    async save(opt) {
        await pool.query(
            `INSERT INTO "${tableName}" (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`,
            [opt.session, JSON.stringify(opt.data)]
        );
    }
    async extract(opt) {
        const res = await pool.query(`SELECT data FROM "${tableName}" WHERE id = $1`, [opt.session]);
        return res.rowCount ? JSON.parse(res.rows[0].data) : null;
    }
    async delete(opt) {
        await pool.query(`DELETE FROM "${tableName}" WHERE id = $1`, [opt.session]);
    }
}

module.exports = process.env.DATABASE_URL ? new PostgresStore() : null;
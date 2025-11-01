const { Pool } = require('pg');
const fs = require('fs');

function waitForFile(filePath, { timeout = 30000, interval = 200 } = {}) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const timer = setInterval(() => {
            if (fs.existsSync(filePath)) {
                clearInterval(timer);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                console.warn(`[PostgresStore] waitForFile timeout after ${timeout}ms for ${filePath}`);
                resolve(false);
            }
        }, interval);
    });
}

class PostgresStore {
    constructor() {
        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });
            this._initPromise = null;
        } catch (error) {
            console.error('Failed to connect to the database:', error);
            throw error; // re-throw the error to halt initialization
        }
    }

    async init() {
        if (!this._initPromise) {
            this._initPromise = this.pool.query(`
                CREATE TABLE IF NOT EXISTS wweb_sessions (
                    session_key VARCHAR(255) PRIMARY KEY,
                    session_data BYTEA
                );
            `);
        }

        try {
            await this._initPromise;
        } catch (error) {
            // Reset the promise so callers can retry initialisation
            this._initPromise = null;
            throw error;
        }
    }

    async save(options) {
        const { session } = options;
        const sessionFilePath = `${session}.zip`;

        // Wait for a short period to allow the file to be written
        await new Promise(resolve => setTimeout(resolve, 1000));

        await this.init();

        const maxAttempts = 3;
        let attempt = 0;
        let lastError;

        while (attempt < maxAttempts) {
            attempt += 1;
            try {
                const fileReady = await waitForFile(sessionFilePath, { timeout: 30000 });

                if (!fileReady) {
                    throw new Error(`Session archive not found within timeout: ${sessionFilePath}`);
                }

                const fileBuffer = fs.readFileSync(sessionFilePath);
                await this.pool.query(
                    'INSERT INTO wweb_sessions (session_key, session_data) VALUES ($1, $2) ON CONFLICT (session_key) DO UPDATE SET session_data = $2',
                    [session, fileBuffer]
                );

                if (attempt > 1) {
                    console.info(`[PostgresStore] Session ${session} persisted after ${attempt} attempts.`);
                }

                return;
            } catch (error) {
                lastError = error;
                console.warn(`[PostgresStore] Failed to persist session ${session} (attempt ${attempt}/${maxAttempts}):`, error);

                if (attempt < maxAttempts) {
                    const backoffMs = 500 * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                }
            }
        }

        throw lastError;
    }

    async extract(options) {
        const { session, path } = options;
        await this.init();
        const result = await this.pool.query('SELECT session_data FROM wweb_sessions WHERE session_key = $1', [session]);

        if (result.rows.length === 0 || !result.rows[0].session_data) {
            return null;
        }

        fs.writeFileSync(path, result.rows[0].session_data);
        return null;
    }

    async delete(options) {
        const { session } = options;
        await this.init();
        await this.pool.query('DELETE FROM wweb_sessions WHERE session_key = $1', [session]);
    }

    async sessionExists(options) {
        const { session } = options;
        await this.init();
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

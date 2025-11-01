const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForExistingPath(possiblePaths, { timeout = 45000, interval = 200 } = {}) {
    const startTime = Date.now();

    while (Date.now() - startTime <= timeout) {
        for (const candidate of possiblePaths) {
            try {
                await fs.promises.access(candidate, fs.constants.F_OK);
                return candidate;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        await sleep(interval);
    }

    console.warn(`[PostgresStore] waitForExistingPath timeout after ${timeout}ms for ${possiblePaths.join(', ')}`);
    return null;
}

async function waitForStableFile(filePath, { timeout = 10000, interval = 200 } = {}) {
    const startTime = Date.now();
    let lastSize = -1;

    while (Date.now() - startTime <= timeout) {
        try {
            const stats = await fs.promises.stat(filePath);
            if (stats.size > 0) {
                if (stats.size === lastSize) {
                    return true;
                }

                lastSize = stats.size;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        await sleep(interval);
    }

    throw new Error(`File did not stabilise within ${timeout}ms: ${filePath}`);
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
        const candidatePaths = [
            path.resolve(`${session}.zip`),
            path.resolve('.wwebjs_auth', `${session}.zip`)
        ];

        await this.init();

        const maxAttempts = 3;
        let attempt = 0;
        let lastError;

        while (attempt < maxAttempts) {
            attempt += 1;
            try {
                const sessionFilePath = await waitForExistingPath(candidatePaths, { timeout: 45000 });

                if (!sessionFilePath) {
                    throw new Error(`Session archive not found within timeout: ${candidatePaths.join(', ')}`);
                }

                await waitForStableFile(sessionFilePath, { timeout: 10000 });

                const fileBuffer = await fs.promises.readFile(sessionFilePath);
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
        const { session, path: targetPath } = options;
        await this.init();
        const result = await this.pool.query('SELECT session_data FROM wweb_sessions WHERE session_key = $1', [session]);

        if (result.rows.length === 0 || !result.rows[0].session_data) {
            return null;
        }

        let sessionData = result.rows[0].session_data;

        if (typeof sessionData === 'string') {
            sessionData = Buffer.from(sessionData.replace(/^\\x/, ''), 'hex');
        }

        const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath);
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.promises.writeFile(absolutePath, sessionData);
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

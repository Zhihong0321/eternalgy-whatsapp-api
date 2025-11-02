const fs = require('fs');
const path = require('path');

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

function uniquePaths(paths) {
    const seen = new Set();
    const result = [];

    for (const candidate of paths) {
        const normalized = path.resolve(candidate);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }

    return result;
}

class FileStore {
    constructor(options = {}) {
        const resolvedPath = options.filePath
            ? path.resolve(options.filePath)
            : path.resolve(__dirname, 'session-store.json');

        this.filePath = resolvedPath;
        this.tempFilePath = `${this.filePath}.tmp`;
        this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
        this.waitIntervalMs = options.waitIntervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
        this.archiveDirectories = uniquePaths([
            process.cwd(),
            path.dirname(this.filePath),
            ...(options.archiveDir ? [options.archiveDir] : []),
            ...(Array.isArray(options.archiveDirectories) ? options.archiveDirectories : []),
        ]);
        this._missingStoreLogged = false;
    }

    async save({ session }) {
        const archivePath = await this._waitForArchive(session);

        try {
            if (!archivePath) {
                console.warn(`[FileStore] Session archive not found for "${session}". Skipping save.`);
                return;
            }

            const archiveBuffer = await fs.promises.readFile(archivePath);
            const store = await this._readStore();

            store[session] = archiveBuffer.toString('base64');
            await this._writeStore(store);
            console.info(`[FileStore] Session "${session}" persisted (${archiveBuffer.length} bytes).`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[FileStore] Session archive disappeared before it could be saved for "${session}".`);
                return;
            }

            console.error(`[FileStore] Failed to save session "${session}":`, error);
            throw error;
        }
    }

    async load({ session, path: destinationPath }) {
        try {
            const store = await this._readStore();
            const storedValue = store[session];

            if (!storedValue) {
                console.info(`[FileStore] No stored session found for "${session}".`);
                return null;
            }

            const buffer = Buffer.from(storedValue, 'base64');
            await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
            await fs.promises.writeFile(destinationPath, buffer);
            console.info(`[FileStore] Session "${session}" restored to ${destinationPath}.`);
            return null;
        } catch (error) {
            console.error(`[FileStore] Failed to load session "${session}":`, error);
            return null;
        }
    }

    async remove({ session }) {
        try {
            const store = await this._readStore();

            if (!store[session]) {
                console.info(`[FileStore] Attempted to remove missing session "${session}".`);
                return;
            }

            delete store[session];
            await this._writeStore(store);
            console.info(`[FileStore] Session "${session}" removed from store.`);
        } catch (error) {
            console.error(`[FileStore] Failed to remove session "${session}":`, error);
        }
    }

    async sessionExists({ session }) {
        try {
            const store = await this._readStore();
            return Boolean(store[session]);
        } catch (error) {
            console.error(`[FileStore] Failed to determine if session exists for "${session}":`, error);
            return false;
        }
    }

    async extract(options) {
        return this.load(options);
    }

    async delete(options) {
        return this.remove(options);
    }

    async _readStore() {
        try {
            const fileContents = await fs.promises.readFile(this.filePath, 'utf8');
            if (!fileContents) {
                return {};
            }

            return JSON.parse(fileContents);
        } catch (error) {
            if (error.code === 'ENOENT') {
                if (!this._missingStoreLogged) {
                    console.info(`[FileStore] Store file not found at ${this.filePath}. Treating as empty.`);
                    this._missingStoreLogged = true;
                }
                return {};
            }

            if (error.name === 'SyntaxError') {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = `${this.filePath}.corrupt-${timestamp}`;

                console.warn(`[FileStore] Store file at ${this.filePath} is not valid JSON. Backing it up to ${backupPath} and treating as empty.`);

                try {
                    await fs.promises.rename(this.filePath, backupPath);
                } catch (renameError) {
                    if (renameError.code === 'ENOENT') {
                        // File disappeared after we attempted to read it. Treat as empty.
                        return {};
                    }

                    console.error(`[FileStore] Failed to back up corrupt store file at ${this.filePath}:`, renameError);
                }

                return {};
            }

            console.error(`[FileStore] Could not read store file at ${this.filePath}. Treating as empty.`, error);
            return {};
        }
    }

    async _writeStore(store) {
        const data = JSON.stringify(store, null, 2);

        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });

        try {
            await fs.promises.writeFile(this.tempFilePath, data, 'utf8');
            await fs.promises.rename(this.tempFilePath, this.filePath);
            this._missingStoreLogged = false;
        } catch (error) {
            console.error(`[FileStore] Failed to persist store file at ${this.filePath}:`, error);
            try {
                await fs.promises.unlink(this.tempFilePath);
            } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') {
                    console.error(`[FileStore] Failed to clean up temporary file ${this.tempFilePath}:`, cleanupError);
                }
            }
            throw error;
        }
    }

    async _waitForArchive(session) {
        const start = Date.now();
        const candidates = this._candidateArchivePaths(session);

        while (Date.now() - start < this.waitTimeoutMs) {
            for (const filePath of candidates) {
                try {
                    await fs.promises.access(filePath);
                    return filePath;
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        throw error;
                    }
                }
            }

            await this._delay(this.waitIntervalMs);
        }

        return null;
    }

    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _candidateArchivePaths(session) {
        const filename = `${session}.zip`;
        const directPath = path.resolve(filename);
        const candidates = new Set([directPath]);

        for (const directory of this.archiveDirectories) {
            const candidate = path.join(path.resolve(directory), filename);
            candidates.add(candidate);
        }

        return Array.from(candidates);
    }
}

module.exports = FileStore;

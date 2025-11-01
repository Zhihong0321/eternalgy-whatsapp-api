const fs = require('fs');
const path = require('path');

class FileStore {
    constructor(options = {}) {
        const resolvedPath = options.filePath
            ? path.resolve(options.filePath)
            : path.resolve(__dirname, 'session-store.json');

        this.filePath = resolvedPath;
        this.tempFilePath = `${this.filePath}.tmp`;
    }

    async save({ session }) {
        const sessionArchivePath = `${session}.zip`;

        try {
            const archiveBuffer = await fs.promises.readFile(sessionArchivePath);
            const store = await this._readStore();

            store[session] = archiveBuffer.toString('base64');
            await this._writeStore(store);
        } catch (error) {
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
            await fs.promises.writeFile(destinationPath, buffer);
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
                console.info(`[FileStore] Store file not found at ${this.filePath}. Treating as empty.`);
                return {};
            }

            if (error.name === 'SyntaxError') {
                console.error(`[FileStore] Store file at ${this.filePath} is not valid JSON. Ignoring contents.`);
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
}

module.exports = FileStore;

const fs = require('fs');
const path = require('path');

const LOCK_DIR = path.join(process.cwd(), '.wwebjs_auth');
const LOCK_FILE = path.join(LOCK_DIR, 'session.lock');
const STALE_THRESHOLD = 60 * 1000; // 60 seconds

const log = (message) => console.log(`[PID: ${process.pid}] ${message}`);

function acquireLock() {
    log('Attempting to acquire lock...');
    // Ensure the session directory exists before trying to create the lock file
    if (!fs.existsSync(LOCK_DIR)) {
        fs.mkdirSync(LOCK_DIR, { recursive: true });
    }

    if (fs.existsSync(LOCK_FILE)) {
        const stats = fs.statSync(LOCK_FILE);
        const now = new Date().getTime();
        const modifiedTime = new Date(stats.mtime).getTime();

        if (now - modifiedTime > STALE_THRESHOLD) {
            log('Found a stale lock file from a previous run. Removing it.');
            fs.unlinkSync(LOCK_FILE);
        } else {
            // The lock file is recent, so another instance is likely running.
            log('A recent lock file was found. Another instance is active.');
            return false;
        }
    }

    try {
        // The 'wx' flag makes this an atomic operation.
        // It will fail if the file already exists, preventing a race condition.
        fs.writeFileSync(LOCK_FILE, new Date().toISOString(), { flag: 'wx' });
        log('Lock acquired successfully.');
        return true;
    } catch (e) {
        if (e.code === 'EEXIST') {
            // This can happen in a race condition where the file was created
            // between the initial check and this write attempt.
            log('Lock file was created by another instance just now.');
            return false;
        }
        // For other errors, we should rethrow them.
        throw e;
    }
}

function releaseLock() {
    if (fs.existsSync(LOCK_FILE)) {
        try {
            fs.unlinkSync(LOCK_FILE);
            log('Lock released successfully.');
        } catch (e) {
            log(`Failed to release lock file: ${e}`);
        }
    }
}

module.exports = { acquireLock, releaseLock };

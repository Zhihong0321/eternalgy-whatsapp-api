const { Client, RemoteAuth, DisconnectReason } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeDataURL = require('qrcode');
const PostgresStore = require('./PostgresStore');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// Define all variables that will be used in routes
let client;
let qrCode = null;
let status = 'initializing';
let phoneNumber = null;
let webhookUrl = null;
let restarting = false;

const store = new PostgresStore();
const remoteAuthStore = {
    save: (...args) => store.save(...args),
    extract: (...args) => store.extract(...args),
    delete: (...args) => store.delete(...args),
    sessionExists: (...args) => store.sessionExists(...args)
};
let initializePromise = null;
let initializing = false;

async function ensureStoreReady() {
    try {
        await store.init();
    } catch (error) {
        console.error('Failed to initialise PostgresStore:', error);
        throw error;
    }
}

// Ensure we don't tear down a browser instance while it's still booting.
async function waitForOngoingInitialization() {
    if (initializing && initializePromise) {
        try {
            await initializePromise;
        } catch (error) {
            console.warn('Previous initialization failed while waiting to restart:', error);
        }
    }
}

async function restartClient(trigger) {
    if (restarting) {
        console.log(`Restart already in progress, ignoring trigger: ${trigger}`);
        return;
    }

    restarting = true;

    try {
        await waitForOngoingInitialization();

        if (client) {
            try {
                await client.destroy();
            } catch (destroyError) {
                console.error('Failed to destroy existing client during restart:', destroyError);
            }
        }

        client = null;
        qrCode = null;
        phoneNumber = null;

        await initialize();
    } catch (error) {
        console.error('Failed to restart WhatsApp client:', error);
    } finally {
        restarting = false;
    }
}

// Define all routes
app.get('/api/status', (req, res) => {
    res.json({
        status: status,
        phoneNumber: phoneNumber,
        hasQrCode: qrCode !== null
    });
});

app.get('/api/qr', (req, res) => {
    if (qrCode) {
        res.json({ success: true, qrCode: qrCode });
    } else {
        res.json({ success: false, message: 'QR code not available' });
    }
});

app.post('/api/send', async (req, res) => {
    const { to, message } = req.body;
    if (status === 'connected' && client) {
        try {
            const msg = await client.sendMessage(to, message);
            res.json({ success: true, messageId: msg.id._serialized, timestamp: msg.timestamp });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
        }
    } else {
        res.status(400).json({ success: false, message: 'Client is not connected or ready' });
    }
});

app.post('/api/webhook/config', (req, res) => {
    const { webhookUrl: newWebhookUrl } = req.body;
    webhookUrl = newWebhookUrl;
    res.json({ success: true, message: 'Webhook URL configured' });
});

app.get('/api/webhook/config', (req, res) => {
    res.json({ success: true, webhookUrl: webhookUrl });
});

app.post('/api/logout', async (req, res) => {
    if (client) {
        try {
            await client.logout();
            res.json({ success: true, message: 'Session cleared' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to logout', error: error.message });
        }
    } else {
        res.status(400).json({ success: false, message: 'Client is not initialized' });
    }
});

const dns = require('dns');

async function checkInternetConnection() {
    return new Promise((resolve) => {
        dns.lookup('google.com', (err) => {
            if (err && err.code === 'ENOTFOUND') {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

app.get('/', async (req, res) => {
    const dbConnected = await store.checkConnection();
    const internetConnected = await checkInternetConnection();

    let html = `
        <h1>WhatsApp API Status</h1>
        <p><strong>WhatsApp Status:</strong> ${status}</p>
        <p><strong>Phone Number:</strong> ${phoneNumber || 'Not Connected'}</p>
        <p><strong>Database Status:</strong> ${dbConnected ? 'Connected' : 'Disconnected'}</p>
        <p><strong>Internet Status:</strong> ${internetConnected ? 'Connected' : 'Disconnected'}</p>
    `;

    if (status === 'waiting_qr') {
        qrcodeDataURL.toDataURL(qrCode, (err, url) => {
            if (err) {
                res.status(500).send('Error generating QR code');
            } else {
                html += `<h2>QR Code</h2><img src="${url}" alt="QR Code">`;
                res.send(html);
            }
        });
    } else {
        res.send(html);
    }
});


// Main async function to handle initialization
async function initialize() {
    if (initializing) {
        return initializePromise;
    }

    initializing = true;
    status = 'initializing';
    console.log('Initializing WhatsApp client...');

    initializePromise = (async () => {
        try {
            console.log('Ensuring PostgresStore is ready...');
            await ensureStoreReady();
            console.log('PostgresStore ready.');

            console.log('Creating WhatsApp client...');
            client = new Client({
                authStrategy: new RemoteAuth({
                    store: remoteAuthStore,
                    clientId: 'remote-session',
                    backupSyncIntervalMs: 300000
                }),
                puppeteer: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox'
                    ]
                }
            });
            console.log('WhatsApp client created.');

            client.on('qr', qr => {
                console.log('QR code received');
                qrcode.generate(qr, { small: true });
                qrCode = qr;
                if (status !== 'connected') {
                    status = 'waiting_qr';
                }
            });

            client.on('ready', () => {
                qrCode = null;
                status = 'connected';
                phoneNumber = client.info && client.info.wid ? client.info.wid.user : phoneNumber;
                console.log('Client is ready!');
            });

            client.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    qrCode = qr;
                    if (status !== 'connected') {
                        status = 'waiting_qr';
                    }
                }

                if (connection === 'open') {
                    status = 'connected';
                    qrCode = null;
                    phoneNumber = client.info && client.info.wid ? client.info.wid.user : phoneNumber;
                    console.log('WhatsApp connection opened.');
                }

                if (connection === 'close') {
                    console.log('WhatsApp connection closed.', lastDisconnect?.error);
                    qrCode = null;
                    phoneNumber = null;
                    status = 'disconnected';

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || lastDisconnect?.error === 'LOGOUT') {
                        console.log('Session logged out. Restarting client to await new QR.');
                        restartClient('logged_out');
                    }
                }
            });

            client.on('auth_failure', (msg) => {
                status = 'auth_failure';
                console.error('Authentication failure', msg);
            });

            client.on('message', async (message) => {
                if (webhookUrl) {
                    try {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            body: JSON.stringify(message.rawData),
                            headers: { 'Content-Type': 'application/json' }
                        });
                    } catch (error) {
                        console.error('Failed to send webhook:', error);
                    }
                }

                if(message.body === '!ping') {
                    message.reply('pong');
                }
            });

            client.on('remote_session_saved', () => {
                console.log('Remote session backup saved successfully.');
            });

            console.log('Initializing WhatsApp client connection...');
            await client.initialize();
            console.log('WhatsApp client initialized.');
        } catch (error) {
            console.error('Initialization failed:', error);
            status = 'failed';
            throw error;
        } finally {
            initializing = false;
            initializePromise = null;
        }
    })();

    return initializePromise;
}

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // Initialize the WhatsApp client after the server has started
    initialize().catch(error => {
        console.error('Failed to initialize WhatsApp client on server start:', error);
    });
});

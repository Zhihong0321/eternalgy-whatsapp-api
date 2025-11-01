const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeDataURL = require('qrcode');
const FileStore = require('./FileStore');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Define all variables that will be used in routes
let client;
let qrCode = null;
let status = 'initializing';
let phoneNumber = null;
let webhookUrl = null;

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
    const store = new FileStore();
    const storedSessionExists = await store.sessionExists({ session: 'RemoteAuth-remote-session' });
    const internetConnected = await checkInternetConnection();

    let html = `
        <h1>WhatsApp API Status</h1>
        <p><strong>WhatsApp Status:</strong> ${status}</p>
        <p><strong>Phone Number:</strong> ${phoneNumber || 'Not Connected'}</p>
        <p><strong>Stored Session Available:</strong> ${storedSessionExists ? 'Yes' : 'No'}</p>
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
    console.log('Initializing WhatsApp client...');
    status = 'initializing';
    try {
        console.log('Setting up FileStore...');
        const store = new FileStore();
        console.log('FileStore ready.');

        console.log('Creating WhatsApp client...');
        client = new Client({
            authStrategy: new RemoteAuth({
                store: store,
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
            status = 'waiting_qr';
        });

        client.on('ready', () => {
            qrCode = null;
            status = 'connected';
            phoneNumber = client.info.wid.user;
            console.log('Client is ready!');
        });

        client.on('disconnected', async (reason) => {
            qrCode = null;
            status = 'disconnected';
            phoneNumber = null;
            console.log('Client was disconnected', reason);

            if (reason === 'LOGOUT') {
                console.log('Client logged out, re-initializing...');
                if (client) {
                    await client.destroy();
                }
                initialize();
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

        console.log('Initializing WhatsApp client...');
        await client.initialize();
        console.log('WhatsApp client initialized.');

    } catch (error) {
        console.error('Initialization failed:', error);
        status = 'failed';
    }
}

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // Initialize the WhatsApp client after the server has started
    initialize();
});
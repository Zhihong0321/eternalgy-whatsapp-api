const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const PostgresStore = require('./PostgresStore');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const store = new PostgresStore();

const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    }
});

let qrCode = null;
let status = 'disconnected';
let phoneNumber = null;

client.on('qr', qr => {
    qrCode = qr;
    status = 'waiting_qr';
});

client.on('ready', () => {
    qrCode = null;
    status = 'connected';
    phoneNumber = client.info.wid.user;
    console.log('Client is ready!');
});

client.on('disconnected', () => {
    qrCode = null;
    status = 'disconnected';
    phoneNumber = null;
    console.log('Client was disconnected');
});

let webhookUrl = null;

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

client.initialize();

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
    if (status === 'connected') {
        try {
            const msg = await client.sendMessage(to, message);
            res.json({ success: true, messageId: msg.id._serialized, timestamp: msg.timestamp });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
        }
    } else {
        res.status(400).json({ success: false, message: 'Client is not connected' });
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
    try {
        await client.logout();
        res.json({ success: true, message: 'Session cleared' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to logout', error: error.message });
    }
});

app.get('/', (req, res) => {
    if (status === 'waiting_qr') {
        qrcode.toDataURL(qrCode, (err, url) => {
            if (err) {
                res.status(500).send('Error generating QR code');
            } else {
                res.send(`<h1>QR Code</h1><img src="${url}" alt="QR Code">`);
            }
        });
    } else if (status === 'connected') {
        res.send(`<h1>WhatsApp Connected</h1><p>Phone Number: ${phoneNumber}</p>`);
    } else {
        res.send(`<h1>WhatsApp Disconnected</h1>`);
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
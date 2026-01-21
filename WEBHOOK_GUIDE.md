# Webhook Guide

## Overview
The WhatsApp API now supports webhooks that trigger automatically when messages are received.

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Webhook (Option A: Environment Variable)
Set the `WEBHOOK_URL` environment variable:
```bash
export WEBHOOK_URL=https://your-server.com/webhook
```

### 2. Configure Webhook (Option B: API Endpoint)
Use the API to set the webhook URL dynamically:

**Set Webhook:**
```bash
POST /api/webhook
Content-Type: application/json

{
  "url": "https://your-server.com/webhook"
}
```

**Get Webhook Status:**
```bash
GET /api/webhook
```

**Disable Webhook:**
```bash
DELETE /api/webhook
```

## Webhook Payload

When a message is received, the webhook will receive a POST request with this payload:

```json
{
  "id": "message_id_serialized",
  "from": "1234567890@c.us",
  "fromName": "Contact Name",
  "body": "Message content",
  "timestamp": 1234567890,
  "hasMedia": false,
  "type": "chat",
  "isGroup": false,
  "chatName": "Chat Name"
}
```

## Example Webhook Server

Here's a simple Express.js webhook receiver:

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', (req, res) => {
  const message = req.body;
  
  console.log('Received message from:', message.fromName);
  console.log('Message:', message.body);
  
  // Your custom logic here
  // - Save to database
  // - Trigger notifications
  // - Auto-reply logic
  // - Forward to other services
  
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

## Testing

1. Start your WhatsApp API server
2. Configure your webhook URL
3. Send a message to your WhatsApp number
4. Check your webhook server logs

## Security Tips

- Use HTTPS for webhook URLs in production
- Validate incoming webhook requests
- Consider adding authentication tokens
- Rate limit your webhook endpoint
- Handle errors gracefully with try-catch blocks

## Troubleshooting

- Check server logs for webhook trigger confirmations
- Ensure your webhook URL is publicly accessible
- Verify your webhook server is running and accepting POST requests
- Check firewall settings if webhook isn't receiving data

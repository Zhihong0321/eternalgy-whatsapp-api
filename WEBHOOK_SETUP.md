# Webhook Setup Guide

## Quick Start

### Option 1: Configure via Web UI (Easiest)

1. Start your WhatsApp API server:
   ```bash
   npm install
   npm start
   ```

2. Open the dashboard in your browser (e.g., `http://localhost:8080`)

3. Look for the **"🔔 Webhook Configuration"** section

4. Enter your webhook URL and click **"Set Webhook"**

5. Done! You'll now receive incoming messages at your webhook URL

### Option 2: Configure via API

```bash
# Set webhook
curl -X POST http://localhost:8080/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/webhook"}'

# Check webhook status
curl http://localhost:8080/api/webhook

# Disable webhook
curl -X DELETE http://localhost:8080/api/webhook
```

### Option 3: Environment Variable

Set the `WEBHOOK_URL` environment variable before starting:

```bash
export WEBHOOK_URL=https://your-server.com/webhook
npm start
```

## Testing Locally with ngrok

If you want to test webhooks on your local machine:

1. **Install ngrok**: https://ngrok.com/download

2. **Start the example webhook server**:
   ```bash
   node webhook-example.js
   ```

3. **Expose it publicly with ngrok**:
   ```bash
   ngrok http 3000
   ```

4. **Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`)

5. **Configure it in your WhatsApp API**:
   - Via UI: Paste `https://abc123.ngrok.io/webhook` in the webhook field
   - Via API: 
     ```bash
     curl -X POST http://localhost:8080/api/webhook \
       -H "Content-Type: application/json" \
       -d '{"url": "https://abc123.ngrok.io/webhook"}'
     ```

6. **Send a test message** to your WhatsApp number

7. **Check the webhook server logs** - you should see the incoming message!

## Webhook Payload Structure

Your webhook will receive POST requests with this JSON payload:

```json
{
  "id": "3EB0C767D71D42D5E1C5",
  "from": "1234567890@c.us",
  "fromName": "John Doe",
  "body": "Hello!",
  "timestamp": 1234567890,
  "hasMedia": false,
  "type": "chat",
  "isGroup": false,
  "chatName": "John Doe"
}
```

## Production Deployment

For production use:

1. **Use HTTPS** - Webhooks should always use secure URLs
2. **Add authentication** - Verify webhook requests with tokens
3. **Handle errors** - Implement retry logic and error handling
4. **Rate limiting** - Protect your webhook endpoint
5. **Logging** - Keep track of received messages
6. **Monitoring** - Set up alerts for webhook failures

## Common Use Cases

- **Auto-reply bot**: Respond to specific keywords
- **Customer support**: Route messages to your CRM
- **Notifications**: Alert your team about new messages
- **Analytics**: Track message patterns and volumes
- **Integration**: Connect to Slack, Discord, email, etc.

## Troubleshooting

**Webhook not receiving messages?**
- Check if webhook is enabled: `GET /api/webhook`
- Verify your webhook URL is publicly accessible
- Check your webhook server logs for errors
- Ensure your webhook responds with 200 status code

**Getting timeout errors?**
- Your webhook must respond within 10 seconds
- Process messages asynchronously if needed
- Return success immediately, process later

**Messages not triggering webhook?**
- Verify WhatsApp is connected (check dashboard)
- Send a test message to your WhatsApp number
- Check server logs for webhook trigger attempts

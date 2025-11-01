# WhatsApp API Server

A robust WhatsApp API server built with Node.js and whatsapp-web.js for Bubble.io integration.

## Features

- 🚀 Multiple WhatsApp sessions support
- 📱 Send/receive text messages and images
- 👥 Create and manage WhatsApp groups
- 📊 Message status tracking (sent, delivered, read)
- 🔔 Webhook notifications for incoming messages
- 🎛️ Web dashboard for monitoring sessions
- 🔐 API key authentication
- 🔄 Auto-restart on disconnection
- 📚 Complete API documentation

## Quick Start

### Prerequisites

- Node.js 18.x or higher
- Git (for deployment)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR-USERNAME/whatsapp-api-server.git
   cd whatsapp-api-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` file with your settings:
   ```env
   PORT=3000
   API_KEY=your-secret-api-key-here
   WEBHOOK_URL=https://your-webhook-endpoint.com/webhook
   ```

5. Start the server:
   ```bash
   npm start
   ```

6. Open your browser and go to `http://localhost:3000` to see the dashboard.

## API Endpoints

### Authentication

All API endpoints require authentication via the `x-api-key` header:

```bash
curl -H "x-api-key: your-secret-api-key-here" \
     -X POST http://localhost:3000/api/start-session
```

### Main Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/start-session` | Start a new WhatsApp session |
| `GET` | `/api/session/:sessionId/status` | Get session status and QR code |
| `POST` | `/api/send-message` | Send a text message |
| `POST` | `/api/send-image` | Send an image with optional caption |
| `POST` | `/api/create-group` | Create a WhatsApp group |
| `GET` | `/api/webhooks/:sessionId` | Get webhook events for a session |
| `GET` | `/api/sessions` | List all active sessions |
| `DELETE` | `/api/session/:sessionId` | Terminate a session |

### Example Usage

#### 1. Start a Session

```bash
curl -H "x-api-key: your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"sessionName": "My Bot"}' \
     -X POST http://localhost:3000/api/start-session
```

Response:
```json
{
  "success": true,
  "sessionId": "uuid-here",
  "sessionName": "My Bot",
  "status": "initializing"
}
```

#### 2. Get QR Code

```bash
curl -H "x-api-key: your-api-key" \
     -X GET http://localhost:3000/api/session/YOUR-SESSION-ID/status
```

Response:
```json
{
  "sessionId": "uuid-here",
  "status": "qr_ready",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

#### 3. Send Message

```bash
curl -H "x-api-key: your-api-key" \
     -H "Content-Type: application/json" \
     -d '{
       "sessionId": "your-session-id",
       "to": "1234567890@c.us",
       "message": "Hello from WhatsApp API!"
     }' \
     -X POST http://localhost:3000/api/send-message
```

#### 4. Send Image

```bash
curl -H "x-api-key: your-api-key" \
     -F "sessionId=your-session-id" \
     -F "to=1234567890@c.us" \
     -F "caption=Check out this image!" \
     -F "image=@/path/to/your/image.jpg" \
     -X POST http://localhost:3000/api/send-image
```

## Phone Number Format

Use the international format without + symbol:
- ✅ `1234567890@c.us` (individual)
- ✅ `1234567890-1234567890@g.us` (group)

## Bubble.io Integration

### Step 1: Set up API Connector

1. Go to your Bubble.io editor
2. Navigate to Plugins → Add plugins → API Connector
3. Add a new API with these settings:
   - **Name**: WhatsApp API
   - **Authentication**: Private key in header
   - **Header key**: `x-api-key`
   - **Header value**: `your-secret-api-key-here`

### Step 2: Configure API Calls

#### Send Message Call:
- **API Call Name**: Send WhatsApp Message
- **Use as**: Action
- **Data type**: JSON
- **URL**: `https://your-heroku-app.herokuapp.com/api/send-message`
- **Method**: POST
- **Headers**: `Content-Type: application/json`
- **Body type**: JSON
- **Body**:
  ```json
  {
    "sessionId": "<sessionId>",
    "to": "<to>",
    "message": "<message>"
  }
  ```

#### Get Session Status Call:
- **API Call Name**: Get Session Status
- **Use as**: Data
- **URL**: `https://your-heroku-app.herokuapp.com/api/session/<sessionId>/status`
- **Method**: GET

### Step 3: Create Workflows

1. **Start Session Workflow**:
   - Trigger: Button click
   - Action: API Connector - Start Session
   - Store sessionId in a custom state

2. **Send Message Workflow**:
   - Trigger: Button click or form submission
   - Action: API Connector - Send WhatsApp Message
   - Parameters: sessionId, recipient, message

## Deployment on Heroku

### Method 1: Using Heroku CLI

1. Install Heroku CLI from [here](https://devcenter.heroku.com/articles/heroku-cli)

2. Login to Heroku:
   ```bash
   heroku login
   ```

3. Create a new Heroku app:
   ```bash
   heroku create your-whatsapp-api-server
   ```

4. Set environment variables:
   ```bash
   heroku config:set API_KEY=your-secret-api-key-here
   heroku config:set WEBHOOK_URL=https://your-webhook-endpoint.com/webhook
   ```

5. Deploy:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push heroku main
   ```

### Method 2: Using GitHub Integration

1. Push your code to GitHub
2. Go to [Heroku Dashboard](https://dashboard.heroku.com/)
3. Create new app
4. Connect to GitHub repository
5. Set environment variables in Settings → Config Vars
6. Deploy from GitHub

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `API_KEY` | API authentication key | Yes |
| `WEBHOOK_URL` | Webhook endpoint for notifications | No |
| `NODE_ENV` | Environment (production/development) | No |

## Webhook Events

The server sends webhook notifications for these events:

- `ready` - Session is ready
- `message` - New message received
- `message_ack` - Message status update
- `auth_failure` - Authentication failed
- `disconnected` - Session disconnected

## Troubleshooting

### Common Issues

1. **Session not starting**: Check if the API key is correct
2. **QR code not generating**: Wait a few seconds and check status again
3. **Messages not sending**: Ensure session status is "ready"
4. **Heroku deployment fails**: Check if all environment variables are set

### Logs

Check server logs for debugging:
```bash
# Local
npm start

# Heroku
heroku logs --tail -a your-app-name
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Create an issue on GitHub
- Check the API documentation at `/api/docs`
- Review the logs for error messages

---

**Note**: This is for internal company use only. Make sure to keep your API key secure and don't expose it in client-side code.

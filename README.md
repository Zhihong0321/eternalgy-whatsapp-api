# Whatsapp API Server

This project sets up a WhatsApp API server using `whatsapp-web.js`.

## Deployment to Railway and PostgreSQL Integration

### 1. Create a GitHub Repository

- Create a new repository on GitHub and push your project to it.

### 2. Deploy to Railway

- Go to [railway.app](https://railway.app) and create a new project.
- Connect your GitHub repository to the project.
- Railway will automatically detect the `package.json` and deploy your application.

### 3. Add PostgreSQL Database

- In your Railway project, add a new service and select "PostgreSQL".
- Railway will provision a new database and provide you with the connection URL.

### 4. Configure Environment Variables

- In your Railway project settings, add the following environment variable:
  - `DATABASE_URL`: The connection URL for your PostgreSQL database.

## API Documentation

### GET /api/status

Get WhatsApp connection status.

**Response:**

```json
{
    "status": "connected|waiting_qr|disconnected",
    "phoneNumber": "...",
    "hasQrCode": true/false
}
```

### GET /api/qr

Get QR code for WhatsApp authentication.

**Response:**

```json
{
    "success": true,
    "qrCode": "..."
}
```

### POST /api/send

Send a WhatsApp message.

**Body:**

```json
{
    "to": "1234567890@c.us",
    "message": "Hello World"
}
```

**Response:**

```json
{
    "success": true,
    "messageId": "...",
    "timestamp": "..."
}
```

### POST /api/webhook/config

Configure webhook URL for incoming messages.

**Body:**

```json
{
    "webhookUrl": "https://your-webhook.com"
}
```

**Response:**

```json
{
    "success": true,
    "message": "Webhook URL configured"
}
```

### GET /api/webhook/config

Get current webhook configuration.

**Response:**

```json
{
    "success": true,
    "webhookUrl": "..."
}
```

### POST /api/logout

Logout and reset WhatsApp session.

**Response:**

```json
{
    "success": true,
    "message": "Session cleared"
}
```
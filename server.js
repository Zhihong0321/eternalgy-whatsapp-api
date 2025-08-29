const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ 
    status: 'Infrastructure Setup Complete',
    message: 'WhatsApp API Server - Ready for coding phase',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Infrastructure test server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
});
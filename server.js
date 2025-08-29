const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ 
    status: 'TESTING - GitHub Auto Deploy',
    message: 'This should override existing deployment',
    timestamp: new Date().toISOString(),
    source: 'GitHub Repository',
    commit: 'Testing deployment override'
  });
});

app.get('/test-deploy', (req, res) => {
  res.json({
    message: 'This endpoint confirms our code is deployed',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Infrastructure test server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
});
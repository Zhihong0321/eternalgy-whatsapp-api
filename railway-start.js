#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔍 Railway Chrome Detection Script');

// Try to find Chrome executable
const commands = [
  'which chromium-browser',
  'which chromium', 
  'which google-chrome',
  'which google-chrome-stable',
  'find /nix/store -name chromium -type f 2>/dev/null | head -1',
  'find /usr -name chromium* -type f 2>/dev/null | head -1'
];

let chromePath = null;

for (const cmd of commands) {
  try {
    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    if (result && fs.existsSync(result)) {
      chromePath = result;
      console.log(`✅ Found Chrome: ${chromePath}`);
      break;
    }
  } catch (e) {
    // Command failed, try next
  }
}

if (chromePath) {
  process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;
  console.log(`🚀 Starting server with Chrome: ${chromePath}`);
} else {
  console.log('⚠️  No Chrome found, using Puppeteer bundled version');
}

// Start the actual server
require('./server.js');
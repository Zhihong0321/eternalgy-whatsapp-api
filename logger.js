const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'whatsapp-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let output = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(meta).length > 0) {
            output += ` ${JSON.stringify(meta)}`;
          }
          return output;
        })
      )
    })
  ]
});

logger.info('Logger initialized', { 
  environment: process.env.NODE_ENV || 'development',
  logLevel: logger.level,
  timestamp: new Date().toISOString()
});

module.exports = logger;
/**
 * Simple Logger utility for DNA Analysis Web Application
 * Provides basic logging functionality without external dependencies
 */

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

class SimpleLogger {
    constructor() {
        this.level = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;
        this.appLogPath = path.join(logsDir, 'app.log');
        this.errorLogPath = path.join(logsDir, 'error.log');
    }

    formatMessage(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}\n`;
    }

    writeToFile(filePath, content) {
        try {
            fs.appendFileSync(filePath, content);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    log(level, message, meta = {}) {
        if (LOG_LEVELS[level] > this.level) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, meta);
        
        // Write to console
        if (level === 'error') {
            console.error(formattedMessage.trim());
        } else if (level === 'warn') {
            console.warn(formattedMessage.trim());
        } else {
            console.log(formattedMessage.trim());
        }

        // Write to app log
        this.writeToFile(this.appLogPath, formattedMessage);

        // Write errors to error log
        if (level === 'error') {
            this.writeToFile(this.errorLogPath, formattedMessage);
        }
    }

    error(message, meta = {}) {
        this.log('error', message, meta);
    }

    warn(message, meta = {}) {
        this.log('warn', message, meta);
    }

    info(message, meta = {}) {
        this.log('info', message, meta);
    }

    debug(message, meta = {}) {
        this.log('debug', message, meta);
    }
}

const logger = new SimpleLogger();

module.exports = { logger };
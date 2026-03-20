import log from 'electron-log'
import { app } from 'electron'
import { join } from 'path'

/**
 * Structured log entry interface
 */
export interface StructuredLogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  category: string
  message: string
  data?: Record<string, unknown>
  correlationId?: string
}

/**
 * Log rotation configuration
 */
export interface LogRotationConfig {
  maxSize: number
  maxFiles: number
  compress: boolean
}

/**
 * Structured logger wrapper with category support
 */
class StructuredLogger {
  private baseLogger: log.LogFunctions
  private defaultCategory: string = 'app'
  private correlationId: string | null = null

  constructor(baseLogger: log.LogFunctions) {
    this.baseLogger = baseLogger
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string | null): void {
    this.correlationId = id
  }

  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | null {
    return this.correlationId
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    const id = crypto.randomUUID().substring(0, 8)
    this.correlationId = id
    return id
  }

  /**
   * Create a child logger with a default category
   */
  child(category: string): CategoryLogger {
    return new CategoryLogger(this, category)
  }

  /**
   * Format structured log entry
   */
  private formatEntry(
    level: 'debug' | 'info' | 'warn' | 'error',
    category: string,
    message: string,
    data?: Record<string, unknown>
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message
    }

    if (data) {
      entry.data = data
    }

    if (this.correlationId) {
      entry.correlationId = this.correlationId
    }

    return entry
  }

  /**
   * Log at debug level
   */
  debug(category: string, message: string, data?: Record<string, unknown>): void {
    const entry = this.formatEntry('debug', category, message, data)
    this.baseLogger.debug(JSON.stringify(entry))
  }

  /**
   * Log at info level
   */
  info(category: string, message: string, data?: Record<string, unknown>): void {
    const entry = this.formatEntry('info', category, message, data)
    this.baseLogger.info(JSON.stringify(entry))
  }

  /**
   * Log at warn level
   */
  warn(category: string, message: string, data?: Record<string, unknown>): void {
    const entry = this.formatEntry('warn', category, message, data)
    this.baseLogger.warn(JSON.stringify(entry))
  }

  /**
   * Log at error level
   */
  error(category: string, message: string, data?: Record<string, unknown>): void {
    const entry = this.formatEntry('error', category, message, data)
    this.baseLogger.error(JSON.stringify(entry))
  }
}

/**
 * Category-specific logger
 */
class CategoryLogger {
  constructor(
    private parent: StructuredLogger,
    private category: string
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.parent.debug(this.category, message, data)
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.parent.info(this.category, message, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.parent.warn(this.category, message, data)
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.parent.error(this.category, message, data)
  }
}

// Global structured logger instance
let structuredLogger: StructuredLogger

export function setupLogger() {
  // Configure log file paths
  const logPath = app.getPath('logs')

  log.transports.file.resolvePathFn = () => {
    return join(logPath, 'main.log')
  }

  // Set log level based on environment
  if (process.env.NODE_ENV === 'development') {
    log.transports.console.level = 'debug'
    log.transports.file.level = 'debug'
  } else {
    log.transports.console.level = 'info'
    log.transports.file.level = 'info'
  }

  // Log file rotation (keep last 7 days, max 10MB per file)
  log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB

  // Configure log format for file transport
  log.transports.file.format = '{text}'

  // Catch unhandled errors
  log.catchErrors({
    showDialog: false,
    onError: (error) => {
      console.error('Unhandled error:', error)
    }
  })

  // Initialize structured logger
  structuredLogger = new StructuredLogger(log)

  return log
}

/**
 * Configure log rotation settings
 */
export function configureLogRotation(config: Partial<LogRotationConfig>): void {
  if (config.maxSize !== undefined) {
    log.transports.file.maxSize = config.maxSize
  }
  // Note: electron-log handles maxFiles and compression differently
  // The default behavior keeps old log files with date suffixes
}

/**
 * Get structured logger for advanced logging
 */
export function getStructuredLogger(): StructuredLogger {
  if (!structuredLogger) {
    throw new Error('Logger not initialized. Call setupLogger() first.')
  }
  return structuredLogger
}

/**
 * Create a category logger for a specific module
 */
export function createLogger(category: string): CategoryLogger {
  return getStructuredLogger().child(category)
}

// Export a logger instance for direct import (backward compatible)
export const logger = {
  debug: (category: string, message: string, data?: Record<string, unknown>) => {
    getStructuredLogger().debug(category, message, data)
  },
  info: (category: string, message: string, data?: Record<string, unknown>) => {
    getStructuredLogger().info(category, message, data)
  },
  warn: (category: string, message: string, data?: Record<string, unknown>) => {
    getStructuredLogger().warn(category, message, data)
  },
  error: (category: string, message: string, data?: Record<string, unknown>) => {
    getStructuredLogger().error(category, message, data)
  }
}

export default setupLogger
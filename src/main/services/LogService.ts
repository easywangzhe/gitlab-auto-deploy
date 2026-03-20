/**
 * Log Service - In-memory log storage with limits for UI display
 */

import { logger } from '../utils/logger'

export type LogCategory = 'gitlab-poll' | 'build' | 'deploy' | 'daemon'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  category: LogCategory
  message: string
  data?: Record<string, unknown>
}

interface LogBuffer {
  entries: LogEntry[]
  maxSize: number
}

class LogService {
  private buffers: Map<LogCategory, LogBuffer> = new Map()
  private idCounter: number = 0

  constructor() {
    // Initialize buffers for each category
    this.buffers.set('gitlab-poll', { entries: [], maxSize: 100 })
    this.buffers.set('build', { entries: [], maxSize: 100 })
    this.buffers.set('deploy', { entries: [], maxSize: 100 })
    this.buffers.set('daemon', { entries: [], maxSize: 100 })
  }

  /**
   * Add a log entry
   */
  log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      level,
      category,
      message,
      data
    }

    // Add to specific category buffer
    this.addToBuffer(category, entry)

    // Also write to file logger
    logger[level](category, message, data)
  }

  /**
   * Convenience methods
   */
  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(category, 'debug', message, data)
  }

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(category, 'info', message, data)
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(category, 'warn', message, data)
  }

  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(category, 'error', message, data)
  }

  /**
   * Get logs for a specific category
   */
  getLogs(category: LogCategory, limit?: number): LogEntry[] {
    const buffer = this.buffers.get(category)
    if (!buffer) return []

    const entries = [...buffer.entries].reverse() // Most recent first
    return limit ? entries.slice(0, limit) : entries
  }

  /**
   * Get all logs merged and sorted by timestamp
   */
  getAllLogs(limit?: number): LogEntry[] {
    const allEntries: LogEntry[] = []
    for (const buffer of this.buffers.values()) {
      allEntries.push(...buffer.entries)
    }
    // Sort by timestamp descending (most recent first)
    allEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    return limit ? allEntries.slice(0, limit) : allEntries
  }

  /**
   * Clear logs for a specific category
   */
  clearLogs(category: LogCategory): void {
    const buffer = this.buffers.get(category)
    if (buffer) {
      buffer.entries = []
    }
  }

  /**
   * Clear all logs
   */
  clearAllLogs(): void {
    for (const buffer of this.buffers.values()) {
      buffer.entries = []
    }
  }

  /**
   * Get log statistics
   */
  getStats(): Record<LogCategory, { count: number; maxSize: number }> {
    const stats: Record<string, { count: number; maxSize: number }> = {}

    for (const [category, buffer] of this.buffers) {
      stats[category] = {
        count: buffer.entries.length,
        maxSize: buffer.maxSize
      }
    }

    return stats as Record<LogCategory, { count: number; maxSize: number }>
  }

  /**
   * Add entry to buffer with size limit
   */
  private addToBuffer(category: LogCategory, entry: LogEntry): void {
    const buffer = this.buffers.get(category)
    if (!buffer) return

    buffer.entries.push(entry)

    // Remove oldest entries if over limit
    while (buffer.entries.length > buffer.maxSize) {
      buffer.entries.shift()
    }
  }

  /**
   * Generate unique ID for log entry
   */
  private generateId(): string {
    return `${Date.now()}-${++this.idCounter}`
  }
}

// Singleton instance
export const logService = new LogService()
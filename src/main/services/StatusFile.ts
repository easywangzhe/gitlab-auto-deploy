/**
 * Status File Service - Writes daemon status to file for systemd/external monitoring
 *
 * Status file format (JSON):
 * {
 *   "status": "running" | "stopped" | "starting" | "stopping" | "error",
 *   "lastPollTime": ISO timestamp | null,
 *   "projectsMonitored": number,
 *   "deploymentsTriggered": number,
 *   "error": string | null,
 *   "pid": number,
 *   "uptime": number (seconds)
 * }
 */

import { app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '../utils/logger'

const getStatusFilePath = (): string => {
  return path.join(app.getPath('userData'), 'daemon-status.json')
}

interface DaemonStatusFile {
  status: string
  lastPollTime: string | null
  projectsMonitored: number
  deploymentsTriggered: number
  error: string | null
  pid: number
  uptime: number
  startedAt: string | null
}

let startTime: Date | null = null

/**
 * Initialize status file with starting state
 */
export async function initStatusFile(): Promise<void> {
  startTime = new Date()
  await writeStatusFile({
    status: 'starting',
    lastPollTime: null,
    projectsMonitored: 0,
    deploymentsTriggered: 0,
    error: null,
    pid: process.pid,
    uptime: 0,
    startedAt: startTime.toISOString()
  })
}

/**
 * Write daemon status to file
 */
export async function writeStatusFile(data: Partial<DaemonStatusFile>): Promise<void> {
  try {
    const statusPath = getStatusFilePath()

    // Calculate uptime
    const uptime = startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0

    const status: DaemonStatusFile = {
      status: data.status || 'unknown',
      lastPollTime: data.lastPollTime || null,
      projectsMonitored: data.projectsMonitored ?? 0,
      deploymentsTriggered: data.deploymentsTriggered ?? 0,
      error: data.error || null,
      pid: process.pid,
      uptime: data.uptime ?? uptime,
      startedAt: startTime?.toISOString() || null
    }

    await fs.writeFile(statusPath, JSON.stringify(status, null, 2))
    logger.debug('status-file', 'Status file updated', { status: status.status })
  } catch (error) {
    logger.error('status-file', 'Failed to write status file', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Update specific fields in status file
 */
export async function updateStatusFile(updates: Partial<DaemonStatusFile>): Promise<void> {
  try {
    const statusPath = getStatusFilePath()
    let currentStatus: DaemonStatusFile

    // Try to read existing status
    try {
      const data = await fs.readFile(statusPath, 'utf-8')
      currentStatus = JSON.parse(data)
    } catch {
      // File doesn't exist or invalid, create new
      currentStatus = {
        status: 'unknown',
        lastPollTime: null,
        projectsMonitored: 0,
        deploymentsTriggered: 0,
        error: null,
        pid: process.pid,
        uptime: 0,
        startedAt: startTime?.toISOString() || null
      }
    }

    // Merge updates
    await writeStatusFile({ ...currentStatus, ...updates })
  } catch (error) {
    logger.error('status-file', 'Failed to update status file', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Clean up status file on shutdown
 */
export async function cleanupStatusFile(): Promise<void> {
  try {
    const statusPath = getStatusFilePath()

    // Write final stopped status
    await writeStatusFile({
      status: 'stopped',
      error: null
    })

    // Optionally remove the file
    // await fs.unlink(statusPath)

    logger.info('status-file', 'Status file cleaned up')
  } catch (error) {
    logger.error('status-file', 'Failed to cleanup status file', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Get current status from file (for external reading)
 */
export async function readStatusFile(): Promise<DaemonStatusFile | null> {
  try {
    const statusPath = getStatusFilePath()
    const data = await fs.readFile(statusPath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * Get status file path for external tools
 */
export function getStatusFilePathPublic(): string {
  return getStatusFilePath()
}
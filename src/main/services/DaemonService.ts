/**
 * Daemon Service - Background service that polls GitLab for MR merges
 * and triggers automatic deployments
 */

import { GitLabProject, MergeRequest, AppSettings } from '../../shared/types'
import { gitLabService } from './GitLabService'
import { deploymentQueue } from './DeploymentQueue'
import { getSettings, getAllProjects } from './IPCHandlers'
import { logService } from './LogService'
import { BrowserWindow, Notification, app } from 'electron'
import { initStatusFile, updateStatusFile, cleanupStatusFile } from './StatusFile'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

interface MonitoredProject {
  project: GitLabProject
  targetBranch: string
  lastCheckTime: Date
}

type DaemonStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

interface DaemonState {
  status: DaemonStatus
  lastPollTime: Date | null
  error: string | null
  projectsMonitored: number
  deploymentsTriggered: number
}

interface LastCheckTimesCache {
  [projectId: string]: string // ISO date string
}

class DaemonService {
  private pollingInterval: NodeJS.Timeout | null = null
  private monitoredProjects: Map<string, MonitoredProject> = new Map()
  private state: DaemonState = {
    status: 'stopped',
    lastPollTime: null,
    error: null,
    projectsMonitored: 0,
    deploymentsTriggered: 0
  }
  private onStatusChange?: (status: DaemonState) => void

  /**
   * Get the path to the last check times cache file
   */
  private getLastCheckTimesPath(): string {
    return path.join(app.getPath('userData'), 'data', 'last-check-times.json')
  }

  /**
   * Load last check times from cache file
   */
  private loadLastCheckTimes(): LastCheckTimesCache {
    try {
      const cachePath = this.getLastCheckTimesPath()
      if (fs.existsSync(cachePath)) {
        const data = fs.readFileSync(cachePath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (error) {
      logService.warn('daemon', 'Failed to load last check times cache', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
    return {}
  }

  /**
   * Save last check times to cache file
   */
  private saveLastCheckTimes(): void {
    try {
      const cachePath = this.getLastCheckTimesPath()
      const cacheDir = path.dirname(cachePath)

      // Ensure directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true })
      }

      const cache: LastCheckTimesCache = {}
      for (const [projectId, monitored] of this.monitoredProjects) {
        cache[projectId] = monitored.lastCheckTime.toISOString()
      }

      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
      logService.debug('daemon', 'Saved last check times cache', {
        projectCount: Object.keys(cache).length
      })
    } catch (error) {
      logService.error('daemon', 'Failed to save last check times cache', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Get cached last check time for a project, or return current time if not cached
   */
  private getCachedLastCheckTime(projectId: string): Date {
    const cache = this.loadLastCheckTimes()
    if (cache[projectId]) {
      const cached = new Date(cache[projectId])
      logService.info('daemon', 'Loaded cached last check time', {
        projectId,
        cachedTime: cached.toISOString()
      })
      return cached
    }
    // No cache, use current time (first startup or cache cleared)
    const now = new Date()
    logService.info('daemon', 'No cached last check time, using current time', {
      projectId,
      currentTime: now.toISOString()
    })
    return now
  }

  /**
   * Set callback for status changes
   */
  setOnStatusChange(callback: (status: DaemonState) => void): void {
    this.onStatusChange = callback
  }

  /**
   * Get current daemon state
   */
  getState(): DaemonState {
    return { ...this.state }
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.state.status === 'running') {
      logService.warn('daemon', 'Daemon is already running')
      return
    }

    try {
      this.updateStatus('starting')
      logService.info('daemon', 'Starting daemon...')
      await initStatusFile()

      // Load settings and projects to monitor
      const settings = getSettings()
      if (!settings) {
        logService.error('daemon', 'Settings not loaded')
        throw new Error('Settings not loaded')
      }

      // Note: daemon.enabled check is done by the caller (SettingsView) before calling start
      // We don't check it here because start() is explicitly called by user action

      // Initialize monitored projects
      await this.initializeMonitoredProjects(settings)

      // Start the deployment queue
      deploymentQueue.start()

      // Start polling (even if no projects yet, so new projects can be detected)
      const pollingIntervalMs = settings.daemon.pollingInterval || 60000
      this.startPolling(pollingIntervalMs)

      this.updateStatus('running', null, this.monitoredProjects.size)
      logService.info('daemon', `Daemon started successfully, monitoring ${this.monitoredProjects.size} project(s)`)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.updateStatus('error', errorMessage)
      logService.error('daemon', `Failed to start daemon: ${errorMessage}`)
      throw error
    }
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (this.state.status === 'stopped') {
      return
    }

    try {
      this.updateStatus('stopping')
      logService.info('daemon', 'Stopping daemon...')

      // Stop polling
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval)
        this.pollingInterval = null
      }

      // Stop the deployment queue
      deploymentQueue.stop()

      // Clear monitored projects
      this.monitoredProjects.clear()

      this.updateStatus('stopped', null, 0)
      logService.info('daemon', 'Daemon stopped successfully')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.updateStatus('error', errorMessage)
      logService.error('daemon', `Failed to stop daemon: ${errorMessage}`)
      throw error
    }
  }

  /**
   * Restart the daemon (useful when settings change)
   */
  async restart(): Promise<void> {
    logService.info('daemon', 'Restarting daemon...')
    await this.stop()
    await this.start()
  }

  /**
   * Initialize the list of projects to monitor
   */
  private async initializeMonitoredProjects(settings: AppSettings): Promise<void> {
    this.monitoredProjects.clear()

    logService.debug('daemon', 'Initializing monitored projects')

    // Get all projects from IPCHandlers
    const allProjects = getAllProjects()

    // Add projects with autoDeploy enabled
    for (const project of allProjects) {
      if (project.autoDeploy) {
        this.addMonitoredProject(project, project.branch || 'main')
      }
    }

    logService.info('daemon', `Loaded ${this.monitoredProjects.size} project(s) for monitoring`)
    this.state.projectsMonitored = this.monitoredProjects.size
  }

  /**
   * Add a project to monitor (called from IPCHandlers when projects are loaded)
   */
  addMonitoredProject(
    project: GitLabProject,
    targetBranch: string
  ): void {
    if (!project.autoDeploy) {
      return
    }

    // Get cached last check time, or use current time if not cached
    const lastCheckTime = this.getCachedLastCheckTime(project.id)

    const monitored: MonitoredProject = {
      project,
      targetBranch,
      lastCheckTime
    }

    this.monitoredProjects.set(project.id, monitored)
    logService.info('daemon', `Added project to monitor: ${project.name}`, {
      projectId: project.id,
      branch: targetBranch,
      lastCheckTime: lastCheckTime.toISOString()
    })

    this.state.projectsMonitored = this.monitoredProjects.size
  }

  /**
   * Remove a project from monitoring
   */
  removeMonitoredProject(projectId: string): void {
    this.monitoredProjects.delete(projectId)
    logService.info('daemon', `Removed project from monitoring: ${projectId}`)

    this.state.projectsMonitored = this.monitoredProjects.size
  }

  /**
   * Update a monitored project's configuration
   */
  updateMonitoredProject(
    project: GitLabProject,
    targetBranch: string
  ): void {
    if (!project.autoDeploy) {
      this.removeMonitoredProject(project.id)
      return
    }

    this.addMonitoredProject(project, targetBranch)
  }

  /**
   * Start the polling loop
   */
  private startPolling(intervalMs: number): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
    }

    // Run initial poll
    this.poll()

    // Set up interval
    this.pollingInterval = setInterval(() => {
      this.poll()
    }, intervalMs)

    logService.info('daemon', `Started polling with interval ${intervalMs / 1000} seconds`)
  }

  /**
   * Poll all monitored projects for new merged MRs
   */
  private async poll(): Promise<void> {
    if (this.monitoredProjects.size === 0) {
      return
    }

    this.state.lastPollTime = new Date()

    // Get settings for connections
    const settings = getSettings()
    if (!settings) {
      logService.error('gitlab-poll', 'Settings not available during poll')
      return
    }

    // Poll each monitored project
    const pollPromises = Array.from(this.monitoredProjects.values()).map(
      async (monitored) => {
        try {
          await this.pollProject(monitored, settings)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          logService.error('gitlab-poll', `Failed to poll project ${monitored.project.name}`, {
            error: errorMsg,
            projectId: monitored.project.id
          })
        }
      }
    )

    await Promise.allSettled(pollPromises)
  }

  /**
   * Poll a single project for new merged MRs
   */
  private async pollProject(
    monitored: MonitoredProject,
    settings: AppSettings
  ): Promise<void> {
    const { project, targetBranch, lastCheckTime } = monitored

    // Get the GitLab connection from global settings
    const connection = settings.gitlabConnection
    if (!connection) {
      logService.warn('gitlab-poll', 'GitLab connection not configured', {
        projectId: project.id
      })
      return
    }

    // Debug: Log connection details
    logService.debug('gitlab-poll', 'GitLab connection details for polling', {
      apiUrl: connection.apiUrl,
      tokenExists: !!connection.token,
      tokenLength: connection.token?.length || 0,
      connectionName: connection.name
    })

    try {
      logService.debug('gitlab-poll', `Polling project: ${project.name}`, {
        projectId: project.id,
        branch: targetBranch,
        lastCheckTime: lastCheckTime.toISOString()
      })

      // Connect to GitLab if needed
      await gitLabService.connect(connection)

      const gitlabProjectId = project.gitlabId?.toString() || project.id
      let shouldDeploy = false
      let deployReason = ''

      // Method 1: Check for GitLab MR merges
      const newMergedMRs = await gitLabService.checkMergedMRs(
        gitlabProjectId,
        targetBranch,
        lastCheckTime
      )

      if (newMergedMRs.length > 0) {
        shouldDeploy = true
        deployReason = `MR merged: ${newMergedMRs.map(mr => mr.title).join(', ')}`
        logService.info('gitlab-poll', `Found ${newMergedMRs.length} new merged MR(s) for ${project.name}`, {
          projectId: project.id,
          mrCount: newMergedMRs.length,
          mrTitles: newMergedMRs.map(mr => mr.title)
        })

        // Trigger deployments for each new MR
        for (const mr of newMergedMRs) {
          await this.triggerDeployment(project, mr)
        }
      }

      // Method 2: Check for direct pushes to the branch
      const branchCheck = await gitLabService.checkBranchCommits(
        gitlabProjectId,
        targetBranch,
        lastCheckTime
      )

      if (branchCheck.hasNewCommits && !shouldDeploy) {
        shouldDeploy = true
        deployReason = `New commit: ${branchCheck.latestCommit?.message?.split('\n')[0] || 'Unknown'}`
        logService.info('gitlab-poll', `Found new commits on ${targetBranch} for ${project.name}`, {
          projectId: project.id,
          branch: targetBranch,
          latestCommit: branchCheck.latestCommit?.sha,
          message: branchCheck.latestCommit?.message?.split('\n')[0]
        })

        // Create a synthetic MR for the deployment
        const syntheticMR: MergeRequest = {
          id: crypto.randomUUID(),
          gitlabId: 0,
          sourceBranch: targetBranch,
          targetBranch: targetBranch,
          state: 'merged' as const,
          title: `Direct push: ${branchCheck.latestCommit?.message?.split('\n')[0] || 'New commit'}`,
          author: 'system',
          projectId: project.id,
          sha: branchCheck.latestCommit?.sha || '',
          mergedAt: branchCheck.latestCommit?.authoredAt
        }

        await this.triggerDeployment(project, syntheticMR)
      }

      // Update last check time
      monitored.lastCheckTime = new Date()
      gitLabService.setLastCheckTime(project.id, monitored.lastCheckTime)

      // Save to cache file
      this.saveLastCheckTimes()

      if (!shouldDeploy) {
        logService.debug('gitlab-poll', `No new changes for ${project.name}`)
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logService.error('gitlab-poll', `Error polling project ${project.name}`, {
        error: errorMsg,
        projectId: project.id
      })
    }
  }

  /**
   * Trigger a deployment for a merged MR
   */
  private async triggerDeployment(
    project: GitLabProject,
    mr: MergeRequest
  ): Promise<void> {
    try {
      logService.info('daemon', `Triggering deployment for MR "${mr.title}"`, {
        projectId: project.id,
        mrId: mr.gitlabId
      })

      // Enqueue the deployment
      const deploymentId = await deploymentQueue.enqueue(project, mr)

      this.state.deploymentsTriggered++

      // Send notification
      this.sendNotification(
        'Deployment Started',
        `Deploying "${project.name}" for MR "${mr.title}"`
      )

      // Broadcast to all windows
      this.broadcast('daemon:deployment-triggered', {
        deploymentId,
        projectId: project.id,
        mrId: mr.gitlabId,
        mrTitle: mr.title
      })

      logService.info('daemon', `Deployment ${deploymentId} enqueued`, {
        projectId: project.id,
        mrId: mr.gitlabId
      })

    } catch (error) {
      logService.error('daemon', `Failed to trigger deployment`, {
        projectId: project.id,
        mrId: mr.gitlabId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      this.sendNotification(
        'Deployment Failed',
        `Failed to deploy "${project.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Update daemon status and notify listeners
   */
  private updateStatus(
    status: DaemonStatus,
    error: string | null = null,
    projectsMonitored: number = this.state.projectsMonitored
  ): void {
    this.state.status = status
    this.state.error = error
    this.state.projectsMonitored = projectsMonitored

    // Update status file for systemd monitoring
    updateStatusFile({
      status,
      error,
      projectsMonitored,
      lastPollTime: this.state.lastPollTime?.toISOString() || null,
      deploymentsTriggered: this.state.deploymentsTriggered
    }).catch((err) => {
      logService.error('daemon', 'Failed to update status file', {
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    })

    // Notify callback
    this.onStatusChange?.(this.getState())

    // Broadcast to all windows
    this.broadcast('daemon:status', this.getState())
  }

  /**
   * Send a desktop notification
   */
  private sendNotification(title: string, body: string): void {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body })
      notification.show()
    }
  }

  /**
   * Broadcast message to all renderer windows
   */
  private broadcast(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send(channel, data)
    })
  }
}

// Singleton instance
export const daemonService = new DaemonService()
/**
 * Deployment Queue - Project-level parallel deployment with serial execution per project
 */

import {
  Deployment,
  DeploymentStatusEnum,
  MergeRequest,
  GitLabProject,
  Server,
  SSHCredentials
} from '../../shared/types'
import { deployService } from './DeployService'
import { buildService } from './BuildService'
import { credentialService } from './CredentialService'
import { getSettings, getProject } from './IPCHandlers'
import { webhookService } from './WebhookService'
import { prometheusMetrics } from './PrometheusMetricsService'
import { logService } from './LogService'
import { logger } from '../utils/logger'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'

interface QueueItem {
  deploymentId: string
  projectId: string
  mergeRequest: MergeRequest
  project: GitLabProject
  priority: number
  addedAt: Date
}

interface ProjectQueue {
  projectId: string
  items: QueueItem[]
  isProcessing: boolean
}

export class DeploymentQueue {
  private projectQueues: Map<string, ProjectQueue> = new Map()
  private activeDeployments: Map<string, QueueItem> = new Map()
  private maxParallelProjects: number = 3
  private processingInterval: NodeJS.Timeout | null = null
  private onDeploymentUpdate?: (deployment: Deployment) => void

  constructor(maxParallel: number = 3) {
    this.maxParallelProjects = maxParallel
  }

  setMaxParallel(max: number): void {
    this.maxParallelProjects = max
  }

  setUpdateCallback(callback: (deployment: Deployment) => void): void {
    this.onDeploymentUpdate = callback
  }

  /**
   * Add a deployment to the queue
   * Returns the deployment ID
   */
  async enqueue(
    project: GitLabProject,
    mr: MergeRequest,
    priority: number = 0
  ): Promise<string> {
    const deployment = await deployService.startDeployment(project.id, mr)

    const item: QueueItem = {
      deploymentId: deployment.id,
      projectId: project.id,
      mergeRequest: mr,
      project,
      priority,
      addedAt: new Date()
    }

    // Get or create project queue
    let projectQueue = this.projectQueues.get(project.id)
    if (!projectQueue) {
      projectQueue = {
        projectId: project.id,
        items: [],
        isProcessing: false
      }
      this.projectQueues.set(project.id, projectQueue)
    }

    // Insert by priority (higher priority first)
    let insertIndex = projectQueue.items.length
    for (let i = 0; i < projectQueue.items.length; i++) {
      if (priority > projectQueue.items[i].priority) {
        insertIndex = i
        break
      }
    }
    projectQueue.items.splice(insertIndex, 0, item)

    logger.info('queue', `Enqueued deployment ${deployment.id}`, {
      projectId: project.id,
      mrId: mr.gitlabId,
      queuePosition: insertIndex + 1,
      priority
    })

    // Save queue state for persistence
    await this.saveQueueState()

    // Trigger processing
    this.processQueue()

    return deployment.id
  }

  /**
   * Cancel a deployment
   */
  async cancel(deploymentId: string): Promise<boolean> {
    // Check if it's active
    const activeItem = this.activeDeployments.get(deploymentId)
    if (activeItem) {
      deployService.updateDeploymentStatus(
        deploymentId,
        DeploymentStatusEnum.enum.cancelled
      )
      this.activeDeployments.delete(deploymentId)
      logger.info('queue', `Cancelled active deployment ${deploymentId}`)
      return true
    }

    // Check if it's queued
    for (const [projectId, queue] of this.projectQueues) {
      const index = queue.items.findIndex(i => i.deploymentId === deploymentId)
      if (index >= 0) {
        queue.items.splice(index, 1)
        deployService.updateDeploymentStatus(
          deploymentId,
          DeploymentStatusEnum.enum.cancelled
        )
        logger.info('queue', `Cancelled queued deployment ${deploymentId}`, {
          projectId
        })
        // Save queue state for persistence
        await this.saveQueueState()
        return true
      }
    }

    return false
  }

  /**
   * Get queue status for a project
   */
  getProjectQueueStatus(projectId: string): {
    queueLength: number
    isProcessing: boolean
    activeDeployment?: string
  } {
    const queue = this.projectQueues.get(projectId)
    return {
      queueLength: queue?.items.length || 0,
      isProcessing: queue?.isProcessing || false,
      activeDeployment: queue?.isProcessing
        ? queue.items[0]?.deploymentId
        : undefined
    }
  }

  /**
   * Get overall queue status
   */
  getQueueStatus(): {
    totalQueued: number
    activeCount: number
    projectQueues: Array<{
      projectId: string
      queueLength: number
      isProcessing: boolean
    }>
  } {
    const projectQueueStatus = Array.from(this.projectQueues.entries()).map(
      ([projectId, queue]) => ({
        projectId,
        queueLength: queue.items.length,
        isProcessing: queue.isProcessing
      })
    )

    return {
      totalQueued: projectQueueStatus.reduce((sum, q) => sum + q.queueLength, 0),
      activeCount: this.activeDeployments.size,
      projectQueues: projectQueueStatus
    }
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (this.processingInterval) {
      return
    }

    this.processingInterval = setInterval(() => {
      this.processQueue()
    }, 1000)

    logger.info('queue', 'Started deployment queue processing')
  }

  /**
   * Stop processing the queue
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
      logger.info('queue', 'Stopped deployment queue processing')
    }
  }

  /**
   * Process the queue - start deployments for available slots
   */
  private processQueue(): void {
    // Count active projects (projects currently processing)
    const activeProjects = new Set(
      Array.from(this.projectQueues.values())
        .filter(q => q.isProcessing)
        .map(q => q.projectId)
    )

    // Also count from activeDeployments
    for (const item of this.activeDeployments.values()) {
      activeProjects.add(item.projectId)
    }

    // Check if we have capacity for more parallel deployments
    if (activeProjects.size >= this.maxParallelProjects) {
      return
    }

    // Find projects that have queued items and are not currently processing
    const availableProjects = Array.from(this.projectQueues.entries())
      .filter(([projectId, queue]) =>
        queue.items.length > 0 &&
        !queue.isProcessing &&
        !activeProjects.has(projectId)
      )
      .sort((a, b) => {
        // Sort by priority of first item, then by added time
        const aPriority = a[1].items[0].priority
        const bPriority = b[1].items[0].priority
        if (aPriority !== bPriority) {
          return bPriority - aPriority
        }
        return a[1].items[0].addedAt.getTime() - b[1].items[0].addedAt.getTime()
      })

    // Start deployments for available slots
    const slotsAvailable = this.maxParallelProjects - activeProjects.size

    for (let i = 0; i < Math.min(slotsAvailable, availableProjects.length); i++) {
      const [projectId, queue] = availableProjects[i]
      this.startNextDeployment(projectId, queue)
    }
  }

  /**
   * Start the next deployment in a project's queue
   */
  private async startNextDeployment(
    projectId: string,
    queue: ProjectQueue
  ): Promise<void> {
    if (queue.items.length === 0 || queue.isProcessing) {
      return
    }

    const item = queue.items[0]
    queue.isProcessing = true
    this.activeDeployments.set(item.deploymentId, item)

    logger.info('queue', `Starting deployment ${item.deploymentId}`, {
      projectId,
      mrId: item.mergeRequest.gitlabId
    })

    // Run deployment asynchronously
    this.executeDeployment(item)
      .then(() => {
        // Remove from queue after completion
        queue.items.shift()
        queue.isProcessing = false
        this.activeDeployments.delete(item.deploymentId)

        logger.info('queue', `Completed deployment ${item.deploymentId}`, {
          projectId
        })

        // Save queue state for persistence
        this.saveQueueState().catch(err => {
          logger.error('queue', 'Failed to save queue state after completion', { error: err })
        })

        // Process next item in queue
        this.processQueue()
      })
      .catch(error => {
        logger.error('queue', `Deployment ${item.deploymentId} failed`, {
          error,
          projectId
        })

        // Remove from queue on failure
        queue.items.shift()
        queue.isProcessing = false
        this.activeDeployments.delete(item.deploymentId)

        // Save queue state for persistence
        this.saveQueueState().catch(err => {
          logger.error('queue', 'Failed to save queue state after failure', { error: err })
        })

        // Process next item in queue
        this.processQueue()
      })
  }

  /**
   * Execute a full deployment workflow
   */
  private async executeDeployment(item: QueueItem): Promise<void> {
    const { deploymentId, project, mergeRequest } = item
    const deployment = deployService.getDeployment(deploymentId)

    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`)
    }

    try {
      // Update status and progress
      deployService.updateDeploymentStatus(
        deploymentId,
        DeploymentStatusEnum.enum.cloning
      )
      deployService.updateProgress(deploymentId, 5)
      deployService.addDeploymentLog(
        deploymentId,
        'info',
        `Starting deployment for MR "${mergeRequest.title}"`
      )

      // Track start time for metrics
      const startTime = Date.now()

      // Notify update
      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Trigger webhook for deployment started
      webhookService.trigger('deployment.started', deployment, project, mergeRequest)

      // Update metrics for in-progress deployment
      prometheusMetrics.updateInProgressDeployments(project.id, 1)

      // Step 1: Clone repository
      deployService.addDeploymentLog(deploymentId, 'info', 'Cloning repository...')
      logService.info('build', `Cloning repository for ${project.name}`, {
        projectId: project.id,
        branch: mergeRequest.sourceBranch
      })

      // Get GitLab connection settings for cloning
      const settings = getSettings()
      const gitlabConnection = settings?.gitlabConnection
      const gitlabUrl = gitlabConnection?.apiUrl
      const gitlabToken = gitlabConnection?.token

      const projectPath = await buildService.clone(
        project,
        mergeRequest.sourceBranch,
        gitlabUrl,
        gitlabToken
      )
      deployService.updateProgress(deploymentId, 10)
      deployService.addDeploymentLog(deploymentId, 'info', `Cloned to ${projectPath}`)
      logService.info('build', `Repository cloned to ${projectPath}`, { projectId: project.id })

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Step 2: Install dependencies
      deployService.updateDeploymentStatus(
        deploymentId,
        DeploymentStatusEnum.enum.installing
      )
      deployService.updateProgress(deploymentId, 15)
      deployService.addDeploymentLog(deploymentId, 'info', 'Detecting package manager...')
      logService.debug('build', 'Detecting package manager', { projectId: project.id })
      const packageManager = await buildService.detectPackageManager(projectPath)
      deployService.addDeploymentLog(deploymentId, 'info', `Using ${packageManager}`)
      logService.info('build', `Using ${packageManager} for dependencies`, {
        projectId: project.id,
        packageManager
      })

      deployService.addDeploymentLog(deploymentId, 'info', 'Installing dependencies...')
      logService.info('build', `Installing dependencies for ${project.name}`, { projectId: project.id })
      await buildService.installDependencies(projectPath, packageManager)
      deployService.updateProgress(deploymentId, 25)
      deployService.addDeploymentLog(deploymentId, 'info', 'Dependencies installed')
      logService.info('build', `Dependencies installed for ${project.name}`, { projectId: project.id })

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Step 3: Build
      deployService.updateDeploymentStatus(
        deploymentId,
        DeploymentStatusEnum.enum.building
      )
      deployService.updateProgress(deploymentId, 30)
      deployService.addDeploymentLog(deploymentId, 'info', 'Detecting build command...')
      logService.debug('build', 'Detecting build command', { projectId: project.id })
      const buildCommand = await buildService.detectBuildCommand(projectPath)

      if (!buildCommand) {
        logService.error('build', `No build command found for ${project.name}`, { projectId: project.id })
        throw new Error('No build command found in package.json')
      }

      deployService.addDeploymentLog(deploymentId, 'info', `Running build: ${buildCommand}`)
      logService.info('build', `Running build: ${buildCommand}`, {
        projectId: project.id,
        command: buildCommand
      })
      const buildJob = await buildService.build(projectPath, buildCommand)

      if (buildJob.status === 'failed') {
        logService.error('build', `Build failed for ${project.name}`, {
          projectId: project.id,
          error: buildJob.error
        })
        throw new Error(buildJob.error || 'Build failed')
      }

      deployService.updateProgress(deploymentId, 45)
      deployService.addDeploymentLog(deploymentId, 'info', 'Build completed successfully')
      logService.info('build', `Build completed successfully for ${project.name}`, { projectId: project.id })

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Step 4: Get build artifact
      deployService.updateProgress(deploymentId, 50)
      deployService.addDeploymentLog(deploymentId, 'info', 'Locating build output...')
      logService.info('build', 'Locating build output', {
        projectId: project.id,
        outputDir: project.outputDir,
        projectPath,
        projectName: project.name
      })
      logger.info('queue', `Looking for output in ${projectPath}, outputDir: ${project.outputDir}`)
      const artifact = await buildService.getBuildOutput(projectPath, project.outputDir)
      deployService.updateProgress(deploymentId, 55)
      deployService.addDeploymentLog(
        deploymentId,
        'info',
        `Found ${artifact.fileCount} files (${(artifact.totalSize / 1024 / 1024).toFixed(2)} MB)`
      )
      logService.info('build', `Build output ready for ${project.name}`, {
        projectId: project.id,
        fileCount: artifact.fileCount,
        totalSizeMB: (artifact.totalSize / 1024 / 1024).toFixed(2)
      })

      // Step 5: Get deployment config and server
      deployService.updateProgress(deploymentId, 60)
      logService.debug('deploy', 'Getting deployment config', { projectId: project.id })
      const configResult = await this.getDeploymentConfig(project.id)
      if (!configResult) {
        logService.error('deploy', `No deployment configuration found for ${project.name}`, { projectId: project.id })
        throw new Error('No deployment configuration found')
      }

      const { server, credentials } = configResult

      // Get deploy path from project
      const deployPath = project.deployPath
      if (!deployPath) {
        logService.error('deploy', `No deploy path configured for ${project.name}`, { projectId: project.id })
        throw new Error('No deploy path configured for this project')
      }

      // Step 6: Create backup
      deployService.addDeploymentLog(deploymentId, 'info', 'Creating backup...')
      logService.info('deploy', `Creating backup for ${project.name}`, {
        projectId: project.id,
        deployPath
      })
      const backup = await deployService.createBackup(server, credentials, deployPath)
      deployService.updateProgress(deploymentId, 65)
      if (backup) {
        deployService.addDeploymentLog(deploymentId, 'info', `Backup created: ${backup.path}`)
        logService.info('deploy', `Backup created: ${backup.path}`, { projectId: project.id })
      } else {
        deployService.addDeploymentLog(deploymentId, 'info', 'Skipped backup (deploy path does not exist)')
        logService.info('deploy', 'Skipped backup - deploy path does not exist', { projectId: project.id, deployPath })
      }

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Step 7: Upload artifact
      deployService.updateDeploymentStatus(
        deploymentId,
        DeploymentStatusEnum.enum.uploading
      )
      deployService.updateProgress(deploymentId, 70)
      deployService.addDeploymentLog(deploymentId, 'info', 'Uploading to server...')
      logService.info('deploy', `Uploading artifact to ${server.host}:${deployPath}`, {
        projectId: project.id,
        server: server.host,
        deployPath
      })
      await deployService.uploadArtifact(artifact, server, credentials, deployPath)
      deployService.updateProgress(deploymentId, 80)
      deployService.addDeploymentLog(deploymentId, 'info', 'Upload completed')
      logService.info('deploy', `Upload completed for ${project.name}`, { projectId: project.id })

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      // Step 8: Health check (only if healthCheckUrl is configured)
      if (project.healthCheckUrl) {
        deployService.updateDeploymentStatus(
          deploymentId,
          DeploymentStatusEnum.enum.health_check
        )
        deployService.updateProgress(deploymentId, 85)
        deployService.addDeploymentLog(deploymentId, 'info', 'Running health check...')

        const healthCheckConfig = {
          timeout: 10000,
          retryCount: 3,
          retryInterval: 5000,
          expectedStatusCode: 200
        }

        logService.info('deploy', `Running health check for ${project.name}`, {
          projectId: project.id,
          healthUrl: project.healthCheckUrl,
          retryCount: healthCheckConfig.retryCount
        })
        const healthPassed = await deployService.healthCheck(project.healthCheckUrl, healthCheckConfig)

        if (!healthPassed) {
          deployService.addDeploymentLog(deploymentId, 'warn', 'Health check failed')
          logService.warn('deploy', `Health check failed for ${project.name}`, {
            projectId: project.id,
            healthUrl: project.healthCheckUrl
          })
          if (backup) {
            deployService.addDeploymentLog(deploymentId, 'warn', 'Initiating rollback...')
            await deployService.rollback(backup, server, credentials, deployPath)
            throw new Error('Health check failed, rolled back to previous version')
          } else {
            throw new Error('Health check failed, no backup available for rollback')
          }
        }

        deployService.updateProgress(deploymentId, 90)
        deployService.addDeploymentLog(deploymentId, 'info', 'Health check passed')
        logService.info('deploy', `Health check passed for ${project.name}`, { projectId: project.id })
      } else {
        logService.info('deploy', `No health check URL configured, skipping health check`, { projectId: project.id })
      }

      // Step 9: Complete
      deployService.updateProgress(deploymentId, 100)
      deployService.completeDeployment(deploymentId, true)
      deployService.addDeploymentLog(deploymentId, 'info', 'Deployment completed successfully')
      logService.info('deploy', `Deployment completed successfully for ${project.name}`, {
        projectId: project.id,
        duration: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
      })

      // Calculate duration and track metrics
      const duration = (Date.now() - startTime) / 1000
      prometheusMetrics.trackDeploymentDuration(project.id, 'success', duration)
      prometheusMetrics.updateInProgressDeployments(project.id, 0)

      // Trigger webhook for deployment success
      webhookService.trigger('deployment.success', deployService.getDeployment(deploymentId)!, project, mergeRequest)

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      deployService.completeDeployment(deploymentId, false, errorMessage)
      deployService.addDeploymentLog(deploymentId, 'error', errorMessage)
      logService.error('deploy', `Deployment failed for ${project.name}`, {
        projectId: project.id,
        error: errorMessage
      })

      // Calculate duration and track metrics for failure
      const duration = (Date.now() - startTime) / 1000
      prometheusMetrics.trackDeploymentDuration(project.id, 'failed', duration)
      prometheusMetrics.updateInProgressDeployments(project.id, 0)

      // Trigger webhook for deployment failure
      webhookService.trigger('deployment.failed', deployService.getDeployment(deploymentId)!, project, mergeRequest)

      this.onDeploymentUpdate?.(deployService.getDeployment(deploymentId)!)

      throw error
    }
  }

  /**
   * Get deployment configuration (server + credentials)
   * Uses global server configuration from settings
   */
  private async getDeploymentConfig(projectId: string): Promise<{
    server: import('../../shared/types').Server
    credentials: import('../../shared/types').SSHCredentials
  } | null> {
    try {
      // Step 1: Get project
      const project = getProject(projectId)
      if (!project) {
        logger.error('queue', `Project not found: ${projectId}`)
        return null
      }

      // Step 2: Get settings to find global server
      const settings = getSettings()
      if (!settings) {
        logger.error('queue', 'Settings not loaded')
        return null
      }

      // Step 3: Get global server configuration
      const server = settings.server
      if (!server) {
        logger.error('queue', 'No server configured in settings', {
          projectId
        })
        return null
      }

      // Step 4: Get SSH credentials
      let credentials = null
      if (server.authType === 'password') {
        // For password auth, use server password directly
        credentials = { id: '', authType: 'password' as const, password: server.password }
      } else {
        // For privateKey auth, try to get stored credentials or use system default SSH key
        if (server.sshCredentialId) {
          credentials = await credentialService.getSSHCredentials(server.sshCredentialId)
        }

        // If no stored credentials, try system default SSH key (~/.ssh/id_rsa)
        if (!credentials) {
          const os = await import('os')
          const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa')
          try {
            const keyContent = await fs.readFile(defaultKeyPath, 'utf-8')
            credentials = {
              id: 'default',
              authType: 'privateKey' as const,
              privateKey: keyContent
            }
            logger.info('queue', 'Using system default SSH key', { keyPath: defaultKeyPath })
          } catch (err) {
            logger.error('queue', `SSH credentials not found and no default key available: ${server.sshCredentialId}`)
            return null
          }
        }
      }

      logger.info('queue', 'Retrieved deployment config', {
        projectId,
        serverId: server.id,
        serverHost: server.host
      })

      return { server, credentials }
    } catch (error) {
      logger.error('queue', 'Failed to get deployment config', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return null
    }
  }

  // ==================== Queue Persistence ====================

  private getQueueStatePath(): string {
    return path.join(app.getPath('userData'), 'queue-state.json')
  }

  /**
   * Save queue state to disk for persistence across restarts
   */
  private async saveQueueState(): Promise<void> {
    try {
      const state = {
        projectQueues: Array.from(this.projectQueues.entries()).map(([projectId, queue]) => ({
          projectId,
          items: queue.items.map(item => ({
            deploymentId: item.deploymentId,
            projectId: item.projectId,
            mergeRequest: item.mergeRequest,
            project: item.project,
            priority: item.priority,
            addedAt: item.addedAt.toISOString()
          })),
          isProcessing: queue.isProcessing
        })),
        savedAt: new Date().toISOString()
      }

      await fs.writeFile(
        this.getQueueStatePath(),
        JSON.stringify(state, null, 2)
      )

      logger.info('queue', 'Queue state saved', {
        projectCount: state.projectQueues.length,
        totalItems: state.projectQueues.reduce((sum, q) => sum + q.items.length, 0)
      })
    } catch (error) {
      logger.error('queue', 'Failed to save queue state', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Load queue state from disk on startup
   */
  async loadQueueState(): Promise<void> {
    try {
      const statePath = this.getQueueStatePath()
      const data = await fs.readFile(statePath, 'utf-8')
      const state = JSON.parse(data)

      // Restore project queues
      for (const queueData of state.projectQueues) {
        const items: QueueItem[] = queueData.items.map((item: {
          deploymentId: string
          projectId: string
          mergeRequest: MergeRequest
          project: GitLabProject
          priority: number
          addedAt: string
        }) => ({
          deploymentId: item.deploymentId,
          projectId: item.projectId,
          mergeRequest: item.mergeRequest,
          project: item.project,
          priority: item.priority,
          addedAt: new Date(item.addedAt)
        }))

        this.projectQueues.set(queueData.projectId, {
          projectId: queueData.projectId,
          items,
          isProcessing: false // Always start with isProcessing = false on load
        })
      }

      logger.info('queue', 'Queue state loaded', {
        projectCount: this.projectQueues.size,
        savedAt: state.savedAt
      })
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('queue', 'Failed to load queue state, starting fresh', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  }
}

// Singleton instance
export const deploymentQueue = new DeploymentQueue()
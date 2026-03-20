/**
 * IPC Handlers - Main process IPC request handlers
 */

import { ipcMain, BrowserWindow, Notification } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import {
  GitLabProject,
  GitLabProjectSchema,
  DeploymentConfig,
  DeploymentConfigSchema,
  Deployment,
  AppSettings,
  AppSettingsSchema,
  GitLabConnection,
  GitLabConnectionSchema,
  Server,
  ServerSchema,
  GitLabProjectResponse,
  MergeRequest
} from '../../shared/types'
import { gitLabService } from './GitLabService'
import { deployService } from './DeployService'
import { credentialService } from './CredentialService'
import { deploymentQueue } from './DeploymentQueue'
import { daemonService } from './DaemonService'
import { webhookService, WebhookConfig } from './WebhookService'
import { prometheusMetrics, MetricsConfig } from './PrometheusMetricsService'
import { logService, LogCategory } from './LogService'
import { logger } from '../utils/logger'

// Data storage paths
const getDataPath = () => path.join(app.getPath('userData'), 'data')
const getProjectsPath = () => path.join(getDataPath(), 'projects')
const getDeploymentsPath = () => path.join(getDataPath(), 'deployments')
const getSettingsPath = () => path.join(getDataPath(), 'settings.json')

// In-memory stores
let settings: AppSettings | null = null
const projects = new Map<string, GitLabProject>()
const deploymentConfigs = new Map<string, DeploymentConfig>()

// Getter functions for shared access
export function getSettings(): AppSettings | null {
  return settings
}

export function getProject(id: string): GitLabProject | undefined {
  return projects.get(id)
}

export function getAllProjects(): GitLabProject[] {
  return Array.from(projects.values())
}

export function getDeploymentConfigById(projectId: string): DeploymentConfig | undefined {
  return deploymentConfigs.get(projectId)
}

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  await fs.mkdir(getProjectsPath(), { recursive: true })
  await fs.mkdir(getDeploymentsPath(), { recursive: true })
}

// Send to all windows
function sendToAll(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send(channel, ...args)
  })
}

// Load data from disk
async function loadData(): Promise<void> {
  await ensureDataDir()

  // Load settings
  try {
    const settingsData = await fs.readFile(getSettingsPath(), 'utf-8')
    const parsedData = JSON.parse(settingsData)

    // Migration: Handle old array format
    if (parsedData.gitlabConnections && Array.isArray(parsedData.gitlabConnections)) {
      logger.warn('ipc', 'Migrating settings from array format to single instance format')
      if (parsedData.gitlabConnections.length > 0) {
        parsedData.gitlabConnection = parsedData.gitlabConnections[0]
        if (parsedData.gitlabConnections.length > 1) {
          logger.warn('ipc', `Multiple GitLab connections found, only the first one will be preserved`)
        }
      }
      delete parsedData.gitlabConnections
    }
    if (parsedData.servers && Array.isArray(parsedData.servers)) {
      if (parsedData.servers.length > 0) {
        parsedData.server = parsedData.servers[0]
        if (parsedData.servers.length > 1) {
          logger.warn('ipc', `Multiple servers found, only the first one will be preserved`)
        }
      }
      delete parsedData.servers
    }

    // Use safeParse to see validation errors
    const result = AppSettingsSchema.safeParse(parsedData)
    if (result.success) {
      settings = result.data
    } else {
      logger.error('ipc', 'Settings validation failed', { errors: result.error.errors })
      // Use the parsed data directly, ignoring validation errors for optional fields
      settings = parsedData as AppSettings
    }
  } catch (error) {
    logger.error('ipc', 'Failed to load settings', { error: error instanceof Error ? error.message : 'Unknown error' })
    settings = {
      notifications: {
        enabled: true,
        notifyOnSuccess: true,
        notifyOnFailure: true
      },
      daemon: {
        enabled: false,
        pollingInterval: 60000
      }
    }
  }

  // Load projects
  try {
    const projectFiles = await fs.readdir(getProjectsPath())
    for (const file of projectFiles) {
      if (file.endsWith('.json')) {
        const data = await fs.readFile(path.join(getProjectsPath(), file), 'utf-8')
        const parsed = JSON.parse(data)
        // Convert date strings to Date objects
        if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt)
        if (parsed.updatedAt) parsed.updatedAt = new Date(parsed.updatedAt)
        const project = GitLabProjectSchema.parse(parsed)
        projects.set(project.id, project)
      }
    }
  } catch (error) {
    logger.error('ipc', 'Failed to load projects', { error: error instanceof Error ? error.message : 'Unknown error' })
  }

  logger.info('ipc', `Loaded ${projects.size} projects from disk`)

  // Load deployments from disk
  await deployService.loadDeployments()

  // Initialize monitored projects for daemon
  const currentSettings = getSettings()
  if (currentSettings?.daemon?.enabled && currentSettings?.gitlabConnection) {
    for (const project of projects.values()) {
      if (project.autoDeploy) {
        daemonService.addMonitoredProject(
          project,
          project.branch || 'main'
        )
      }
    }
  }

  // Load queue state for persistence across restarts
  await deploymentQueue.loadQueueState()
}

// Save project to disk
async function saveProject(project: GitLabProject): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(
    path.join(getProjectsPath(), `${project.id}.json`),
    JSON.stringify(project, null, 2)
  )
}

// Save settings to disk
async function saveSettingsData(): Promise<void> {
  if (!settings) return
  await ensureDataDir()
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2))
}

// Generate UUID
function generateId(): string {
  return crypto.randomUUID()
}

// Register IPC handlers
export async function registerIPCHandlers(): Promise<void> {
  // Load data on startup
  await loadData()

  // ==================== Projects ====================

  ipcMain.handle('projects:get', async () => {
    return {
      success: true,
      data: Array.from(projects.values())
    }
  })

  ipcMain.handle('projects:get-one', async (_event, id: string) => {
    const project = projects.get(id)
    return {
      success: !!project,
      data: project || null,
      error: project ? undefined : 'Project not found'
    }
  })

  ipcMain.handle('projects:create', async (_event, projectData: Omit<GitLabProject, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const now = new Date()
      const project: GitLabProject = {
        ...projectData,
        id: generateId(),
        createdAt: now,
        updatedAt: now
      }

      GitLabProjectSchema.parse(project)
      projects.set(project.id, project)
      await saveProject(project)

      // Add to daemon monitoring if auto-deploy is enabled and GitLab connection exists
      if (project.autoDeploy && settings?.gitlabConnection) {
        daemonService.addMonitoredProject(
          project,
          project.branch || 'main'
        )
      }

      sendToAll('project:updated', project)

      return { success: true, data: project }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create project'
      }
    }
  })

  ipcMain.handle('projects:update', async (_event, id: string, updates: Partial<GitLabProject>) => {
    try {
      const project = projects.get(id)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      const updated: GitLabProject = {
        ...project,
        ...updates,
        id: project.id,
        createdAt: project.createdAt,
        updatedAt: new Date()
      }

      GitLabProjectSchema.parse(updated)
      projects.set(id, updated)
      await saveProject(updated)

      // Update daemon monitoring if auto-deploy setting changed
      if (updated.autoDeploy && settings?.gitlabConnection) {
        daemonService.updateMonitoredProject(
          updated,
          updated.branch || 'main'
        )
      } else {
        daemonService.removeMonitoredProject(id)
      }

      sendToAll('project:updated', updated)

      return { success: true, data: updated }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update project'
      }
    }
  })

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    try {
      const project = projects.get(id)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      projects.delete(id)
      deploymentConfigs.delete(id)

      // Remove from daemon monitoring
      daemonService.removeMonitoredProject(id)

      try {
        await fs.unlink(path.join(getProjectsPath(), `${id}.json`))
      } catch {
        // File may not exist
      }

      sendToAll('project:deleted', id)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete project'
      }
    }
  })

  // ==================== Deployment Configs ====================

  ipcMain.handle('deployment-config:get', async (_event, projectId: string) => {
    return {
      success: true,
      data: deploymentConfigs.get(projectId) || null
    }
  })

  ipcMain.handle('deployment-config:save', async (_event, projectId: string, config: DeploymentConfig) => {
    try {
      DeploymentConfigSchema.parse(config)
      deploymentConfigs.set(projectId, config)
      return { success: true, data: config }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid deployment config'
      }
    }
  })

  // ==================== Deployments ====================

  ipcMain.handle('deployments:get', async (_event, projectId?: string) => {
    const allDeployments = deployService.getAllDeployments()

    if (projectId) {
      return { success: true, data: allDeployments.filter(d => d.projectId === projectId) }
    }

    return { success: true, data: allDeployments }
  })

  ipcMain.handle('deployments:get-one', async (_event, id: string) => {
    const deployment = deployService.getDeployment(id)
    return { success: true, data: deployment || null }
  })

  ipcMain.handle('deployments:start', async (_event, projectId: string, _mergeRequestId: string) => {
    try {
      const project = projects.get(projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      // Create a minimal MR object for now
      const mr: MergeRequest = {
        id: generateId(),
        gitlabId: 0,
        sourceBranch: project.branch || 'main',
        targetBranch: project.branch || 'main',
        state: 'merged',
        title: 'Manual Deployment',
        projectId
      }

      const deploymentId = await deploymentQueue.enqueue(project, mr)

      const deployment = deployService.getDeployment(deploymentId)
      if (deployment) {
        sendToAll('deployment:started', deployment)
      }

      return { success: true, data: deployment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start deployment'
      }
    }
  })

  ipcMain.handle('deployments:cancel', async (_event, deploymentId: string) => {
    const success = await deploymentQueue.cancel(deploymentId)
    return { success }
  })

  ipcMain.handle('deployments:rollback', async (_event, deploymentId: string) => {
    try {
      const deployment = deployService.getDeployment(deploymentId)
      if (!deployment) {
        return { success: false, error: 'Deployment not found' }
      }

      // Would need to get backup and server info
      return { success: false, error: 'Rollback requires backup configuration' }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Rollback failed'
      }
    }
  })

  ipcMain.handle('deployments:logs', async (_event, deploymentId: string) => {
    const deployment = deployService.getDeployment(deploymentId)
    return { success: true, data: deployment?.logs || [] }
  })

  ipcMain.handle('deployments:delete', async (_event, deploymentId: string) => {
    const success = await deployService.deleteDeployment(deploymentId)
    return { success }
  })

  ipcMain.handle('deployments:open-workspace', async (_event, projectId: string) => {
    try {
      const workspacePath = path.join(app.getPath('userData'), 'workspace', projectId)
      const { shell } = require('electron')

      // Check if directory exists
      try {
        await fs.access(workspacePath)
        await shell.openPath(workspacePath)
        return { success: true }
      } catch {
        return { success: false, error: '目录不存在' }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '打开目录失败' }
    }
  })

  // ==================== Settings ====================

  ipcMain.handle('settings:get', async () => {
    return { success: true, data: settings }
  })

  ipcMain.handle('settings:save', async (_event, newSettings: AppSettings) => {
    try {
      AppSettingsSchema.parse(newSettings)
      settings = newSettings
      await saveSettingsData()

      sendToAll('settings:updated', settings)

      return { success: true, data: settings }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid settings'
      }
    }
  })

  // ==================== GitLab Connections ====================

  ipcMain.handle('gitlab-connection:save', async (_event, connectionData: Omit<GitLabConnection, 'id'>) => {
    try {
      const connection: GitLabConnection = {
        ...connectionData,
        id: settings?.gitlabConnection?.id || generateId()
      }

      GitLabConnectionSchema.parse(connection)
      settings!.gitlabConnection = connection
      await saveSettingsData()

      return { success: true, data: connection }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save connection'
      }
    }
  })

  ipcMain.handle('gitlab-connection:clear', async () => {
    settings!.gitlabConnection = undefined
    await saveSettingsData()
    return { success: true }
  })

  ipcMain.handle('gitlab-connection:test', async (_event, apiUrl: string, token: string) => {
    const success = await credentialService.testGitLabConnection(apiUrl, token)
    return { success: true, data: success }
  })

  // ==================== Servers ====================

  ipcMain.handle('server:save', async (_event, serverData: Omit<Server, 'id'>) => {
    try {
      const now = new Date()
      const server: Server = {
        ...serverData,
        id: settings?.server?.id || generateId(),
        createdAt: settings?.server?.createdAt || now,
        updatedAt: now
      }

      ServerSchema.parse(server)
      settings!.server = server
      await saveSettingsData()

      return { success: true, data: server }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save server'
      }
    }
  })

  ipcMain.handle('server:clear', async () => {
    settings!.server = undefined
    await saveSettingsData()
    return { success: true }
  })

  ipcMain.handle('server:test-ssh', async (
    _event,
    host: string,
    port: number,
    username: string,
    authType: 'privateKey' | 'password',
    privateKey?: string,
    password?: string
  ) => {
    const success = await credentialService.testSSHConnection(host, port, username, authType, privateKey, password)
    return { success: true, data: success }
  })

  // ==================== Notifications ====================

  ipcMain.handle('notification:show', async (_event, options: { title: string; body: string; type?: string }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title,
        body: options.body
      })
      notification.show()
    }
    return { success: true }
  })

  // ==================== GitLab Service ====================

  ipcMain.handle('gitlab:fetch-projects', async () => {
    try {
      const connection = settings?.gitlabConnection
      if (!connection) {
        return { success: false, error: 'GitLab connection not configured' }
      }

      await gitLabService.connect(connection)
      const projects = await gitLabService.fetchProjects()

      return { success: true, data: projects }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch projects'
      }
    }
  })

  ipcMain.handle('gitlab:fetch-mrs', async (_event, projectId: string, targetBranch: string) => {
    try {
      const mrs = await gitLabService.fetchMergeRequests(projectId, targetBranch)
      return { success: true, data: mrs }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch merge requests'
      }
    }
  })

  // ==================== Daemon ====================

  ipcMain.handle('daemon:start', async () => {
    try {
      await daemonService.start()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start daemon'
      }
    }
  })

  ipcMain.handle('daemon:stop', async () => {
    try {
      await daemonService.stop()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop daemon'
      }
    }
  })

  ipcMain.handle('daemon:status', async () => {
    const daemonState = daemonService.getState()
    const queueStatus = deploymentQueue.getQueueStatus()
    return {
      success: true,
      data: {
        ...daemonState,
        queueStatus
      }
    }
  })

  ipcMain.handle('daemon:restart', async () => {
    try {
      await daemonService.restart()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart daemon'
      }
    }
  })

  // ==================== Webhooks ====================

  ipcMain.handle('webhook:list', async () => {
    const configs = webhookService.getConfigs()
    return { success: true, data: configs }
  })

  ipcMain.handle('webhook:add', async (_event, config: WebhookConfig) => {
    try {
      await webhookService.addConfig(config)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add webhook'
      }
    }
  })

  ipcMain.handle('webhook:remove', async (_event, url: string) => {
    try {
      await webhookService.removeConfig(url)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove webhook'
      }
    }
  })

  ipcMain.handle('webhook:test', async (_event, config: WebhookConfig) => {
    const result = await webhookService.testConfig(config)
    return { success: true, data: result }
  })

  // ==================== Prometheus Metrics ====================

  ipcMain.handle('metrics:config', async () => {
    const config = prometheusMetrics.getConfig()
    return { success: true, data: config }
  })

  ipcMain.handle('metrics:update', async (_event, config: Partial<MetricsConfig>) => {
    try {
      prometheusMetrics.updateConfig(config)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update metrics config'
      }
    }
  })

  ipcMain.handle('metrics:export', async () => {
    const metrics = prometheusMetrics.export()
    return { success: true, data: metrics }
  })

  // ==================== Logs ====================

  ipcMain.handle('logs:get', async (_event, category: LogCategory, limit?: number) => {
    const logs = logService.getLogs(category, limit)
    return { success: true, data: logs }
  })

  ipcMain.handle('logs:get-all', async (_event, limit?: number) => {
    const logs = logService.getAllLogs(limit)
    return { success: true, data: logs }
  })

  ipcMain.handle('logs:clear', async (_event, category: LogCategory) => {
    logService.clearLogs(category)
    return { success: true }
  })

  ipcMain.handle('logs:clear-all', async () => {
    logService.clearAllLogs()
    return { success: true }
  })

  ipcMain.handle('logs:stats', async () => {
    const stats = logService.getStats()
    return { success: true, data: stats }
  })

  // ==================== Git-based Rollback ====================

  ipcMain.handle('gitlab:get-commits', async (_event, projectId: string, branch: string, limit?: number) => {
    try {
      const connection = settings?.gitlabConnection
      if (!connection) {
        return { success: false, error: 'GitLab connection not configured' }
      }

      await gitLabService.connect(connection)
      const commits = await gitLabService.getBranchCommits(projectId, branch, limit)
      return { success: true, data: commits }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch commits'
      }
    }
  })

  ipcMain.handle('deployments:last-successful', async (_event, projectId: string) => {
    try {
      const sha = deploymentQueue.getLastSuccessfulCommitSha(projectId)
      return { success: true, data: sha }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get last successful commit'
      }
    }
  })

  ipcMain.handle('deployments:rollback-to-commit', async (_event, projectId: string, commitSha: string, branch: string) => {
    try {
      const project = projects.get(projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }
      const deploymentId = await deploymentQueue.startRollbackDeployment(project, commitSha, branch)
      return { success: true, data: deploymentId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start rollback deployment'
      }
    }
  })

  logger.info('ipc', 'IPC handlers registered')
}

// Set up deployment update callbacks
export function setupDeploymentCallbacks(): void {
  deploymentQueue.setUpdateCallback((deployment) => {
    sendToAll('deployment:progress', {
      deploymentId: deployment.id,
      status: deployment.status,
      progress: deployment.progress || 0,
      message: deployment.logs?.slice(-1)[0]?.message || ''
    })
  })
}
/**
 * Preload script - Exposes IPC APIs to renderer process
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  GitLabProject,
  DeploymentConfig,
  Deployment,
  AppSettings,
  GitLabConnection,
  Server,
  MergeRequest,
  CommitInfo
} from '../shared/types'

// Log types - must match LogService
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

// Result type for IPC responses
interface IPCResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Electron API interface
interface ElectronAPI {
  // Projects
  getProjects: () => Promise<IPCResult<GitLabProject[]>>
  getProject: (id: string) => Promise<IPCResult<GitLabProject | null>>
  createProject: (project: Omit<GitLabProject, 'id' | 'createdAt' | 'updatedAt'>) => Promise<IPCResult<GitLabProject>>
  updateProject: (id: string, updates: Partial<GitLabProject>) => Promise<IPCResult<GitLabProject>>
  deleteProject: (id: string) => Promise<IPCResult<void>>

  // Deployment Configs
  getDeploymentConfig: (projectId: string) => Promise<IPCResult<DeploymentConfig | null>>
  saveDeploymentConfig: (projectId: string, config: DeploymentConfig) => Promise<IPCResult<DeploymentConfig>>

  // Deployments
  getDeployments: (projectId?: string) => Promise<IPCResult<Deployment[]>>
  getDeployment: (id: string) => Promise<IPCResult<Deployment | null>>
  startDeployment: (projectId: string, mergeRequestId: string) => Promise<IPCResult<Deployment>>
  cancelDeployment: (deploymentId: string) => Promise<IPCResult<boolean>>
  rollbackDeployment: (deploymentId: string) => Promise<IPCResult<void>>
  getDeploymentLogs: (deploymentId: string) => Promise<IPCResult<string[]>>
  deleteDeployment: (deploymentId: string) => Promise<IPCResult<boolean>>
  openWorkspace: (projectId: string) => Promise<IPCResult<void>>

  // Settings
  getSettings: () => Promise<IPCResult<AppSettings>>
  saveSettings: (settings: AppSettings) => Promise<IPCResult<AppSettings>>

  // GitLab Connections (multi-connection support)
  getGitLabConnections: () => Promise<IPCResult<GitLabConnection[]>>
  getGitLabConnection: (id: string) => Promise<IPCResult<GitLabConnection | null>>
  createGitLabConnection: (connection: Omit<GitLabConnection, 'id'>) => Promise<IPCResult<GitLabConnection>>
  updateGitLabConnection: (id: string, updates: Partial<GitLabConnection>) => Promise<IPCResult<GitLabConnection>>
  deleteGitLabConnection: (id: string) => Promise<IPCResult<void>>
  testGitLabConnection: (apiUrl: string, token: string) => Promise<IPCResult<boolean>>

  // Servers (multi-server support)
  getServers: () => Promise<IPCResult<Server[]>>
  getServer: (id: string) => Promise<IPCResult<Server | null>>
  createServer: (server: Omit<Server, 'id' | 'createdAt' | 'updatedAt'>) => Promise<IPCResult<Server>>
  updateServer: (id: string, updates: Partial<Server>) => Promise<IPCResult<Server>>
  deleteServer: (id: string) => Promise<IPCResult<void>>
  testSSHConnection: (
    host: string,
    port: number,
    username: string,
    authType: 'privateKey' | 'password',
    privateKey?: string,
    password?: string
  ) => Promise<IPCResult<boolean>>

  // Notifications
  showNotification: (options: { title: string; body: string; type?: string }) => Promise<IPCResult<void>>

  // GitLab Service
  fetchGitLabProjects: (connectionId?: string) => Promise<IPCResult<GitLabProject[]>>
  fetchMergeRequests: (projectId: string, targetBranch: string, connectionId?: string) => Promise<IPCResult<MergeRequest[]>>

  // Daemon
  startDaemon: () => Promise<IPCResult<void>>
  stopDaemon: () => Promise<IPCResult<void>>
  getDaemonStatus: () => Promise<IPCResult<{
    running: boolean
    pollingInterval: number
    totalQueued: number
    activeCount: number
    projectQueues: Array<{
      projectId: string
      queueLength: number
      isProcessing: boolean
    }>
  }>>

  // Event listeners
  onProjectUpdated: (callback: (project: GitLabProject) => void) => () => void
  onProjectDeleted: (callback: (projectId: string) => void) => () => void
  onDeploymentStarted: (callback: (deployment: Deployment) => void) => () => void
  onDeploymentProgress: (callback: (data: {
    deploymentId: string
    status: string
    progress: number
    message: string
  }) => void) => () => void
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => () => void
  removeAllListeners: (channel: string) => void

  // Logs
  getLogs: (category: LogCategory, limit?: number) => Promise<IPCResult<LogEntry[]>>
  getAllLogs: (limit?: number) => Promise<IPCResult<LogEntry[]>>
  clearLogs: (category: LogCategory) => Promise<IPCResult<void>>
  clearAllLogs: () => Promise<IPCResult<void>>
  getLogStats: () => Promise<IPCResult<Record<LogCategory, { count: number; maxSize: number }>>>

  // Git-based Rollback
  getBranchCommits: (projectId: string, branch: string, limit?: number, connectionId?: string) => Promise<IPCResult<CommitInfo[]>>
  getLastSuccessfulCommit: (projectId: string) => Promise<IPCResult<string | null>>
  rollbackToCommit: (projectId: string, commitSha: string, branch: string) => Promise<IPCResult<string>>
}

// Build the API object
const api: ElectronAPI = {
  // Projects
  getProjects: () => ipcRenderer.invoke('projects:get'),
  getProject: (id) => ipcRenderer.invoke('projects:get-one', id),
  createProject: (project) => ipcRenderer.invoke('projects:create', project),
  updateProject: (id, updates) => ipcRenderer.invoke('projects:update', id, updates),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),

  // Deployment Configs
  getDeploymentConfig: (projectId) => ipcRenderer.invoke('deployment-config:get', projectId),
  saveDeploymentConfig: (projectId, config) => ipcRenderer.invoke('deployment-config:save', projectId, config),

  // Deployments
  getDeployments: (projectId) => ipcRenderer.invoke('deployments:get', projectId),
  getDeployment: (id) => ipcRenderer.invoke('deployments:get-one', id),
  startDeployment: (projectId, mergeRequestId) => ipcRenderer.invoke('deployments:start', projectId, mergeRequestId),
  cancelDeployment: (deploymentId) => ipcRenderer.invoke('deployments:cancel', deploymentId),
  rollbackDeployment: (deploymentId) => ipcRenderer.invoke('deployments:rollback', deploymentId),
  getDeploymentLogs: (deploymentId) => ipcRenderer.invoke('deployments:logs', deploymentId),
  deleteDeployment: (deploymentId) => ipcRenderer.invoke('deployments:delete', deploymentId),
  openWorkspace: (projectId) => ipcRenderer.invoke('deployments:open-workspace', projectId),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // GitLab Connections (multi-connection support)
  getGitLabConnections: () => ipcRenderer.invoke('gitlab-connections:list'),
  getGitLabConnection: (id) => ipcRenderer.invoke('gitlab-connections:get', id),
  createGitLabConnection: (connection) => ipcRenderer.invoke('gitlab-connections:create', connection),
  updateGitLabConnection: (id, updates) => ipcRenderer.invoke('gitlab-connections:update', id, updates),
  deleteGitLabConnection: (id) => ipcRenderer.invoke('gitlab-connections:delete', id),
  testGitLabConnection: (apiUrl, token) => ipcRenderer.invoke('gitlab-connections:test', apiUrl, token),

  // Servers (multi-server support)
  getServers: () => ipcRenderer.invoke('servers:list'),
  getServer: (id) => ipcRenderer.invoke('servers:get', id),
  createServer: (server) => ipcRenderer.invoke('servers:create', server),
  updateServer: (id, updates) => ipcRenderer.invoke('servers:update', id, updates),
  deleteServer: (id) => ipcRenderer.invoke('servers:delete', id),
  testSSHConnection: (host, port, username, authType, privateKey, password) =>
    ipcRenderer.invoke('servers:test-ssh', host, port, username, authType, privateKey, password),

  // Notifications
  showNotification: (options) => ipcRenderer.invoke('notification:show', options),

  // GitLab Service
  fetchGitLabProjects: (connectionId) => ipcRenderer.invoke('gitlab:fetch-projects', connectionId),
  fetchMergeRequests: (projectId, targetBranch, connectionId) => ipcRenderer.invoke('gitlab:fetch-mrs', projectId, targetBranch, connectionId),

  // Daemon
  startDaemon: () => ipcRenderer.invoke('daemon:start'),
  stopDaemon: () => ipcRenderer.invoke('daemon:stop'),
  getDaemonStatus: () => ipcRenderer.invoke('daemon:status'),

  // Logs
  getLogs: (category, limit) => ipcRenderer.invoke('logs:get', category, limit),
  getAllLogs: (limit) => ipcRenderer.invoke('logs:get-all', limit),
  clearLogs: (category) => ipcRenderer.invoke('logs:clear', category),
  clearAllLogs: () => ipcRenderer.invoke('logs:clear-all'),
  getLogStats: () => ipcRenderer.invoke('logs:stats'),

  // Git-based Rollback
  getBranchCommits: (projectId, branch, limit, connectionId) => ipcRenderer.invoke('gitlab:get-commits', projectId, branch, limit, connectionId),
  getLastSuccessfulCommit: (projectId) => ipcRenderer.invoke('deployments:last-successful', projectId),
  rollbackToCommit: (projectId, commitSha, branch) => ipcRenderer.invoke('deployments:rollback-to-commit', projectId, commitSha, branch),

  // Event listeners - return cleanup function
  onProjectUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, project: GitLabProject) => callback(project)
    ipcRenderer.on('project:updated', handler)
    return () => ipcRenderer.removeListener('project:updated', handler)
  },

  onProjectDeleted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string) => callback(projectId)
    ipcRenderer.on('project:deleted', handler)
    return () => ipcRenderer.removeListener('project:deleted', handler)
  },

  onDeploymentStarted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, deployment: Deployment) => callback(deployment)
    ipcRenderer.on('deployment:started', handler)
    return () => ipcRenderer.removeListener('deployment:started', handler)
  },

  onDeploymentProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: {
      deploymentId: string
      status: string
      progress: number
      message: string
    }) => callback(data)
    ipcRenderer.on('deployment:progress', handler)
    return () => ipcRenderer.removeListener('deployment:progress', handler)
  },

  onSettingsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings)
    ipcRenderer.on('settings:updated', handler)
    return () => ipcRenderer.removeListener('settings:updated', handler)
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

// Expose to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error('Failed to expose electronAPI:', error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electronAPI = api
}
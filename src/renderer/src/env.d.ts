/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      // Projects
      getProjects: () => Promise<{ success: boolean; data?: import('../shared/types').GitLabProject[]; error?: string }>
      getProject: (id: string) => Promise<{ success: boolean; data?: import('../shared/types').GitLabProject | null; error?: string }>
      createProject: (project: Omit<import('../shared/types').GitLabProject, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; data?: import('../shared/types').GitLabProject; error?: string }>
      updateProject: (id: string, updates: Partial<import('../shared/types').GitLabProject>) => Promise<{ success: boolean; data?: import('../shared/types').GitLabProject; error?: string }>
      deleteProject: (id: string) => Promise<{ success: boolean; error?: string }>

      // Deployment Configs
      getDeploymentConfig: (projectId: string) => Promise<{ success: boolean; data?: import('../shared/types').DeploymentConfig | null; error?: string }>
      saveDeploymentConfig: (projectId: string, config: import('../shared/types').DeploymentConfig) => Promise<{ success: boolean; data?: import('../shared/types').DeploymentConfig; error?: string }>

      // Deployments
      getDeployments: (projectId?: string) => Promise<{ success: boolean; data?: import('../shared/types').Deployment[]; error?: string }>
      getDeployment: (id: string) => Promise<{ success: boolean; data?: import('../shared/types').Deployment | null; error?: string }>
      startDeployment: (projectId: string, mergeRequestId: string) => Promise<{ success: boolean; data?: import('../shared/types').Deployment; error?: string }>
      cancelDeployment: (deploymentId: string) => Promise<{ success: boolean; data?: boolean; error?: string }>
      rollbackDeployment: (deploymentId: string) => Promise<{ success: boolean; error?: string }>
      getDeploymentLogs: (deploymentId: string) => Promise<{ success: boolean; data?: string[]; error?: string }>
      openWorkspace: (projectId: string) => Promise<{ success: boolean; error?: string }>

      // Settings
      getSettings: () => Promise<{ success: boolean; data?: import('../shared/types').AppSettings; error?: string }>
      saveSettings: (settings: import('../shared/types').AppSettings) => Promise<{ success: boolean; data?: import('../shared/types').AppSettings; error?: string }>

      // GitLab Connections
      saveGitLabConnection: (connection: Omit<import('../shared/types').GitLabConnection, 'id'>) => Promise<{ success: boolean; data?: import('../shared/types').GitLabConnection; error?: string }>
      clearGitLabConnection: () => Promise<{ success: boolean; error?: string }>
      testGitLabConnection: (apiUrl: string, token: string) => Promise<{ success: boolean; data?: boolean; error?: string }>

      // Servers
      saveServer: (server: Omit<import('../shared/types').Server, 'id'>) => Promise<{ success: boolean; data?: import('../shared/types').Server; error?: string }>
      clearServer: () => Promise<{ success: boolean; error?: string }>
      testSSHConnection: (host: string, port: number, username: string, authType: 'privateKey' | 'password', privateKey?: string, password?: string) => Promise<{ success: boolean; data?: boolean; error?: string }>

      // Notifications
      showNotification: (options: { title: string; body: string; type?: string }) => Promise<{ success: boolean; error?: string }>

      // GitLab Service
      fetchGitLabProjects: () => Promise<{ success: boolean; data?: import('../shared/types').GitLabProject[]; error?: string }>
      fetchMergeRequests: (projectId: string, targetBranch: string) => Promise<{ success: boolean; data?: import('../shared/types').MergeRequest[]; error?: string }>

      // Daemon
      startDaemon: () => Promise<{ success: boolean; error?: string }>
      stopDaemon: () => Promise<{ success: boolean; error?: string }>
      getDaemonStatus: () => Promise<{ success: boolean; data?: { running: boolean; pollingInterval: number; totalQueued: number; activeCount: number; projectQueues: Array<{ projectId: string; queueLength: number; isProcessing: boolean }> }; error?: string }>

      // Event listeners
      onProjectUpdated: (callback: (project: import('../shared/types').GitLabProject) => void) => () => void
      onProjectDeleted: (callback: (projectId: string) => void) => () => void
      onDeploymentStarted: (callback: (deployment: import('../shared/types').Deployment) => void) => () => void
      onDeploymentProgress: (callback: (data: { deploymentId: string; status: string; progress: number; message: string }) => void) => () => void
      onSettingsUpdated: (callback: (settings: import('../shared/types').AppSettings) => void) => () => void
      removeAllListeners: (channel: string) => void

      // Logs
      getLogs: (category: 'gitlab-poll' | 'build' | 'deploy' | 'daemon', limit?: number) => Promise<{ success: boolean; data?: Array<{ id: string; timestamp: Date; level: 'debug' | 'info' | 'warn' | 'error'; category: 'gitlab-poll' | 'build' | 'deploy' | 'daemon'; message: string; data?: Record<string, unknown> }>; error?: string }>
      getAllLogs: (limit?: number) => Promise<{ success: boolean; data?: Array<{ id: string; timestamp: Date; level: 'debug' | 'info' | 'warn' | 'error'; category: 'gitlab-poll' | 'build' | 'deploy' | 'daemon'; message: string; data?: Record<string, unknown> }>; error?: string }>
      clearLogs: (category: 'gitlab-poll' | 'build' | 'deploy' | 'daemon') => Promise<{ success: boolean; error?: string }>
      clearAllLogs: () => Promise<{ success: boolean; error?: string }>
      getLogStats: () => Promise<{ success: boolean; data?: Record<'gitlab-poll' | 'build' | 'deploy' | 'daemon', { count: number; maxSize: number }>; error?: string }>
    }
  }
}

export {}
/**
 * IPC Event Setup - Subscribe to main process events
 *
 * This module sets up bidirectional IPC communication between
 * the renderer and main process, ensuring state updates propagate
 * within 100ms as per acceptance criteria.
 */

import { useProjectsStore } from './stores/projects'
import { useDeploymentsStore } from './stores/deployments'
import { useSettingsStore } from './stores/settings'
import { useNotificationsStore } from './stores/notifications'

// Cleanup functions for all registered listeners
const cleanupFns: Array<() => void> = []

/**
 * Initialize IPC event listeners for all stores
 * Must be called after Pinia is ready (after app.mount)
 */
export function setupIPCListeners(): void {
  const projectsStore = useProjectsStore()
  const deploymentsStore = useDeploymentsStore()
  const settingsStore = useSettingsStore()
  const notificationsStore = useNotificationsStore()

  // Project events
  if (window.electronAPI?.onProjectUpdated) {
    const unsubscribe = window.electronAPI.onProjectUpdated((project) => {
      projectsStore.handleProjectUpdated(project)
    })
    cleanupFns.push(unsubscribe)
  }

  if (window.electronAPI?.onProjectDeleted) {
    const unsubscribe = window.electronAPI.onProjectDeleted((projectId) => {
      projectsStore.handleProjectDeleted(projectId)
    })
    cleanupFns.push(unsubscribe)
  }

  // Deployment events
  if (window.electronAPI?.onDeploymentStarted) {
    const unsubscribe = window.electronAPI.onDeploymentStarted((deployment) => {
      deploymentsStore.handleDeploymentStarted(deployment)
      // Also trigger notification
      notificationsStore.notifyInfo(
        'Deployment Started',
        `Deployment for project ${deployment.projectId} has started`,
        { deploymentId: deployment.id, projectId: deployment.projectId }
      )
    })
    cleanupFns.push(unsubscribe)
  }

  if (window.electronAPI?.onDeploymentProgress) {
    const unsubscribe = window.electronAPI.onDeploymentProgress((data) => {
      deploymentsStore.handleDeploymentProgress(data)
    })
    cleanupFns.push(unsubscribe)
  }

  if (window.electronAPI?.onSettingsUpdated) {
    const unsubscribe = window.electronAPI.onSettingsUpdated((settings) => {
      settingsStore.handleSettingsUpdated(settings)
    })
    cleanupFns.push(unsubscribe)
  }

  console.log('[IPC] Event listeners initialized')
}

/**
 * Cleanup all IPC event listeners
 * Call this when the app is being destroyed
 */
export function cleanupIPCListeners(): void {
  cleanupFns.forEach((fn) => fn())
  cleanupFns.length = 0
  console.log('[IPC] Event listeners cleaned up')
}

/**
 * Initialize stores with data from main process
 * Should be called after IPC listeners are set up
 */
export async function initializeStores(): Promise<void> {
  const projectsStore = useProjectsStore()
  const settingsStore = useSettingsStore()
  const deploymentsStore = useDeploymentsStore()

  // Load initial data in parallel
  await Promise.all([
    projectsStore.loadProjects(),
    settingsStore.loadSettings(),
    deploymentsStore.loadDeployments()
  ])

  console.log('[IPC] Stores initialized with main process data')
}
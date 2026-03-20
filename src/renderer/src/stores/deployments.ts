/**
 * Deployments Store - Manages deployment queue and history
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Deployment, CommitInfo } from '../../../shared/types'

interface DeploymentProgress {
  deploymentId: string
  status: string
  progress: number
  message: string
}

export const useDeploymentsStore = defineStore('deployments', () => {
  const deployments = ref<Deployment[]>([])
  const activeDeployments = ref<Map<string, DeploymentProgress>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Load deployments from main process
  async function loadDeployments(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await window.electronAPI.getDeployments()
      if (result.success && result.data) {
        deployments.value = result.data
      } else {
        error.value = result.error || 'Failed to load deployments'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error'
    } finally {
      loading.value = false
    }
  }

  // Start a deployment
  async function startDeployment(projectId: string, mergeRequestId: string): Promise<Deployment | null> {
    const result = await window.electronAPI.startDeployment(projectId, mergeRequestId)
    if (result.success && result.data) {
      return result.data
    }
    error.value = result.error || 'Failed to start deployment'
    return null
  }

  // Cancel a deployment
  async function cancelDeployment(deploymentId: string): Promise<boolean> {
    const result = await window.electronAPI.cancelDeployment(deploymentId)
    if (!result.success) {
      error.value = result.error || 'Failed to cancel deployment'
    }
    return result.success
  }

  // Rollback a deployment
  async function rollbackDeployment(deploymentId: string): Promise<boolean> {
    const result = await window.electronAPI.rollbackDeployment(deploymentId)
    if (!result.success) {
      error.value = result.error || 'Failed to rollback deployment'
    }
    return result.success
  }

  // Get deployment logs
  async function getDeploymentLogs(deploymentId: string): Promise<string[]> {
    const result = await window.electronAPI.getDeploymentLogs(deploymentId)
    if (result.success && result.data) {
      return result.data
    }
    return []
  }

  // Delete a deployment
  async function deleteDeployment(deploymentId: string): Promise<boolean> {
    const result = await window.electronAPI.deleteDeployment(deploymentId)
    if (result.success) {
      deployments.value = deployments.value.filter(d => d.id !== deploymentId)
    } else {
      error.value = result.error || 'Failed to delete deployment'
    }
    return result.success
  }

  // Handle IPC events
  function handleDeploymentStarted(deployment: Deployment): void {
    const index = deployments.value.findIndex(d => d.id === deployment.id)
    if (index >= 0) {
      deployments.value[index] = deployment
    } else {
      deployments.value.unshift(deployment)
    }
    activeDeployments.value.set(deployment.id, {
      deploymentId: deployment.id,
      status: deployment.status,
      progress: 0,
      message: 'Deployment started'
    })
  }

  function handleDeploymentProgress(data: DeploymentProgress): void {
    activeDeployments.value.set(data.deploymentId, data)
    
    // Update deployment in list if exists
    const index = deployments.value.findIndex(d => d.id === data.deploymentId)
    if (index >= 0) {
      deployments.value[index].status = data.status as Deployment['status']
      deployments.value[index].progress = data.progress
    }

    // Remove from active if completed/failed/cancelled
    if (['success', 'failed', 'cancelled'].includes(data.status)) {
      setTimeout(() => {
        activeDeployments.value.delete(data.deploymentId)
      }, 5000) // Keep visible for 5 seconds after completion
    }
  }

  // Getters
  function getDeploymentsByProject(projectId: string): Deployment[] {
    return deployments.value.filter(d => d.projectId === projectId)
  }

  // 获取分支 commit 列表（用于回滚选择）
  async function getBranchCommits(projectId: string, branch: string, limit?: number): Promise<CommitInfo[]> {
    const result = await window.electronAPI.getBranchCommits(projectId, branch, limit)
    if (result.success && result.data) {
      return result.data
    }
    error.value = result.error || 'Failed to fetch commits'
    throw new Error(result.error || '获取提交记录失败')
  }

  // 获取上一个成功部署的 commit SHA
  async function getLastSuccessfulCommit(projectId: string): Promise<string | null> {
    const result = await window.electronAPI.getLastSuccessfulCommit(projectId)
    return result.success ? result.data || null : null
  }

  // 启动回滚部署
  async function rollbackToCommit(projectId: string, commitSha: string, branch: string): Promise<string | null> {
    const result = await window.electronAPI.rollbackToCommit(projectId, commitSha, branch)
    if (result.success && result.data) {
      await loadDeployments()
      return result.data
    }
    error.value = result.error || 'Failed to start rollback'
    return null
  }

  const activeDeploymentCount = computed(() => activeDeployments.value.size)

  const isInProgress = computed(() => (deploymentId: string) =>
    activeDeployments.value.has(deploymentId)
  )

  return {
    deployments,
    activeDeployments,
    loading,
    error,
    loadDeployments,
    startDeployment,
    cancelDeployment,
    rollbackDeployment,
    getDeploymentLogs,
    deleteDeployment,
    handleDeploymentStarted,
    handleDeploymentProgress,
    getDeploymentsByProject,
    getBranchCommits,
    getLastSuccessfulCommit,
    rollbackToCommit,
    activeDeploymentCount,
    isInProgress
  }
})

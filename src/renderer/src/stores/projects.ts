/**
 * Projects Store - Manages GitLab projects
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GitLabProject } from '../../../shared/types'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<GitLabProject[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Load projects from main process
  async function loadProjects(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await window.electronAPI.getProjects()
      if (result.success && result.data) {
        projects.value = result.data
      } else {
        error.value = result.error || 'Failed to load projects'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error'
    } finally {
      loading.value = false
    }
  }

  // Create a new project
  async function createProject(project: Omit<GitLabProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<GitLabProject | null> {
    const result = await window.electronAPI.createProject(project)
    if (result.success && result.data) {
      // State update handled by IPC event 'project:updated'
      return result.data
    }
    error.value = result.error || 'Failed to create project'
    return null
  }

  // Update a project
  async function updateProject(id: string, updates: Partial<GitLabProject>): Promise<boolean> {
    const result = await window.electronAPI.updateProject(id, updates)
    if (result.success && result.data) {
      // State update handled by IPC event 'project:updated'
      return true
    }
    error.value = result.error || 'Failed to update project'
    return false
  }

  // Delete a project
  async function deleteProject(id: string): Promise<boolean> {
    const result = await window.electronAPI.deleteProject(id)
    if (result.success) {
      // State update handled by IPC event 'project:deleted'
      return true
    }
    error.value = result.error || 'Failed to delete project'
    return false
  }

  // Handle IPC events
  function handleProjectUpdated(project: GitLabProject): void {
    const index = projects.value.findIndex(p => p.id === project.id)
    if (index >= 0) {
      projects.value[index] = project
    } else {
      projects.value.push(project)
    }
  }

  function handleProjectDeleted(projectId: string): void {
    projects.value = projects.value.filter(p => p.id !== projectId)
  }

  // Getters
  function getProjectById(id: string): GitLabProject | undefined {
    return projects.value.find(p => p.id === id)
  }

  return {
    projects,
    loading,
    error,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    handleProjectUpdated,
    handleProjectDeleted,
    getProjectById
  }
})

/**
 * Settings Store - Manages app settings, GitLab connections, and servers
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppSettings, GitLabConnection, Server } from '../../../shared/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Load settings from main process
  async function loadSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await window.electronAPI.getSettings()
      if (result.success && result.data) {
        settings.value = result.data
      } else {
        error.value = result.error || 'Failed to load settings'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error'
      console.error('[Settings Store] Error:', e)
    } finally {
      loading.value = false
    }
  }

  // Save settings
  async function saveSettings(newSettings: AppSettings): Promise<boolean> {
    const result = await window.electronAPI.saveSettings(newSettings)
    if (result.success && result.data) {
      settings.value = result.data
      return true
    }
    error.value = result.error || 'Failed to save settings'
    return false
  }

  // GitLab Connections (multi-connection support)
  async function getGitLabConnections(): Promise<GitLabConnection[]> {
    const result = await window.electronAPI.getGitLabConnections()
    return result.success ? (result.data || []) : []
  }

  async function getGitLabConnection(id: string): Promise<GitLabConnection | null> {
    const result = await window.electronAPI.getGitLabConnection(id)
    return result.success ? result.data || null : null
  }

  async function createGitLabConnection(connection: Omit<GitLabConnection, 'id'>): Promise<GitLabConnection | null> {
    const result = await window.electronAPI.createGitLabConnection(connection)
    if (result.success && result.data) {
      await loadSettings() // Refresh settings
      return result.data
    }
    error.value = result.error || 'Failed to create connection'
    return null
  }

  async function updateGitLabConnection(id: string, updates: Partial<GitLabConnection>): Promise<GitLabConnection | null> {
    const result = await window.electronAPI.updateGitLabConnection(id, updates)
    if (result.success && result.data) {
      await loadSettings() // Refresh settings
      return result.data
    }
    error.value = result.error || 'Failed to update connection'
    return null
  }

  async function deleteGitLabConnection(id: string): Promise<boolean> {
    const result = await window.electronAPI.deleteGitLabConnection(id)
    if (result.success) {
      await loadSettings() // Refresh settings
      return true
    }
    error.value = result.error || 'Failed to delete connection'
    return false
  }

  async function testGitLabConnection(apiUrl: string, token: string): Promise<boolean> {
    const result = await window.electronAPI.testGitLabConnection(apiUrl, token)
    return result.success && result.data === true
  }

  // Servers (multi-server support)
  async function getServers(): Promise<Server[]> {
    const result = await window.electronAPI.getServers()
    return result.success ? (result.data || []) : []
  }

  async function getServer(id: string): Promise<Server | null> {
    const result = await window.electronAPI.getServer(id)
    return result.success ? result.data || null : null
  }

  async function createServer(server: Omit<Server, 'id' | 'createdAt' | 'updatedAt'>): Promise<Server | null> {
    const result = await window.electronAPI.createServer(server)
    if (result.success && result.data) {
      await loadSettings() // Refresh settings
      return result.data
    }
    error.value = result.error || 'Failed to create server'
    return null
  }

  async function updateServer(id: string, updates: Partial<Server>): Promise<Server | null> {
    const result = await window.electronAPI.updateServer(id, updates)
    if (result.success && result.data) {
      await loadSettings() // Refresh settings
      return result.data
    }
    error.value = result.error || 'Failed to update server'
    return null
  }

  async function deleteServer(id: string): Promise<boolean> {
    const result = await window.electronAPI.deleteServer(id)
    if (result.success) {
      await loadSettings() // Refresh settings
      return true
    }
    error.value = result.error || 'Failed to delete server'
    return false
  }

  async function testSSHConnection(
    host: string,
    port: number,
    username: string,
    authType: 'privateKey' | 'password',
    privateKey?: string,
    password?: string
  ): Promise<boolean> {
    const result = await window.electronAPI.testSSHConnection(host, port, username, authType, privateKey, password)
    return result.success && result.data === true
  }

  // Handle IPC events
  function handleSettingsUpdated(newSettings: AppSettings): void {
    settings.value = newSettings
  }

  // Getters
  const gitlabConnections = computed(() => settings.value?.gitlabConnections || [])
  const servers = computed(() => settings.value?.servers || [])
  const notifications = computed(() => settings.value?.notifications)
  const daemon = computed(() => settings.value?.daemon)

  // Helper: Get connection by ID
  const getGitLabConnectionById = (id: string): GitLabConnection | undefined => {
    return settings.value?.gitlabConnections?.find(c => c.id === id)
  }

  // Helper: Get server by ID
  const getServerById = (id: string): Server | undefined => {
    return settings.value?.servers?.find(s => s.id === id)
  }

  return {
    settings,
    loading,
    error,
    loadSettings,
    saveSettings,
    // GitLab Connections
    getGitLabConnections,
    getGitLabConnection,
    createGitLabConnection,
    updateGitLabConnection,
    deleteGitLabConnection,
    testGitLabConnection,
    // Servers
    getServers,
    getServer,
    createServer,
    updateServer,
    deleteServer,
    testSSHConnection,
    // Event handlers
    handleSettingsUpdated,
    // Getters
    gitlabConnections,
    servers,
    notifications,
    daemon,
    getGitLabConnectionById,
    getServerById
  }
})
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
      console.log('[Settings Store] Load result:', result)
      if (result.success && result.data) {
        settings.value = result.data
        console.log('[Settings Store] gitlabConnection:', result.data.gitlabConnection)
        console.log('[Settings Store] server:', result.data.server)
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

  // GitLab Connections
  async function saveGitLabConnection(connection: Omit<GitLabConnection, 'id'>): Promise<GitLabConnection | null> {
    const result = await window.electronAPI.saveGitLabConnection(connection)
    if (result.success && result.data) {
      if (settings.value) {
        settings.value.gitlabConnection = result.data
      }
      return result.data
    }
    error.value = result.error || 'Failed to save connection'
    return null
  }

  async function clearGitLabConnection(): Promise<boolean> {
    const result = await window.electronAPI.clearGitLabConnection()
    if (result.success && settings.value) {
      settings.value.gitlabConnection = undefined
      return true
    }
    error.value = result.error || 'Failed to clear connection'
    return false
  }

  async function testGitLabConnection(apiUrl: string, token: string): Promise<boolean> {
    const result = await window.electronAPI.testGitLabConnection(apiUrl, token)
    return result.success && result.data === true
  }

  // Servers
  async function saveServer(server: Omit<Server, 'id'>): Promise<Server | null> {
    const result = await window.electronAPI.saveServer(server)
    if (result.success && result.data) {
      if (settings.value) {
        settings.value.server = result.data
      }
      return result.data
    }
    error.value = result.error || 'Failed to save server'
    return null
  }

  async function clearServer(): Promise<boolean> {
    const result = await window.electronAPI.clearServer()
    if (result.success && settings.value) {
      settings.value.server = undefined
      return true
    }
    error.value = result.error || 'Failed to clear server'
    return false
  }

  async function testSSHConnection(host: string, port: number, username: string, privateKey: string): Promise<boolean> {
    const result = await window.electronAPI.testSSHConnection(host, port, username, privateKey)
    return result.success && result.data === true
  }

  // Handle IPC events
  function handleSettingsUpdated(newSettings: AppSettings): void {
    settings.value = newSettings
  }

  // Getters
  const gitlabConnection = computed(() => settings.value?.gitlabConnection)
  const server = computed(() => settings.value?.server)
  const notifications = computed(() => settings.value?.notifications)
  const daemon = computed(() => settings.value?.daemon)

  return {
    settings,
    loading,
    error,
    loadSettings,
    saveSettings,
    saveGitLabConnection,
    clearGitLabConnection,
    testGitLabConnection,
    saveServer,
    clearServer,
    testSSHConnection,
    handleSettingsUpdated,
    gitlabConnection,
    server,
    notifications,
    daemon
  }
})

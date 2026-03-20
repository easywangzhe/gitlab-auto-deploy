/**
 * Notifications Store - Manages in-app and system notifications
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AppNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: Date
  read: boolean
  metadata?: Record<string, unknown>
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<AppNotification[]>([])
  const maxNotifications = 100

  // Generate unique ID
  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // Add a notification
  function addNotification(
    type: AppNotification['type'],
    title: string,
    message: string,
    metadata?: Record<string, unknown>
  ): AppNotification {
    const notification: AppNotification = {
      id: generateId(),
      type,
      title,
      message,
      timestamp: new Date(),
      read: false,
      metadata
    }

    notifications.value.unshift(notification)

    // Keep only the last maxNotifications
    if (notifications.value.length > maxNotifications) {
      notifications.value = notifications.value.slice(0, maxNotifications)
    }

    return notification
  }

  // Convenience methods
  function notifyInfo(title: string, message: string, metadata?: Record<string, unknown>): AppNotification {
    return addNotification('info', title, message, metadata)
  }

  function notifySuccess(title: string, message: string, metadata?: Record<string, unknown>): AppNotification {
    return addNotification('success', title, message, metadata)
  }

  function notifyWarning(title: string, message: string, metadata?: Record<string, unknown>): AppNotification {
    return addNotification('warning', title, message, metadata)
  }

  function notifyError(title: string, message: string, metadata?: Record<string, unknown>): AppNotification {
    return addNotification('error', title, message, metadata)
  }

  // Mark as read
  function markAsRead(id: string): void {
    const notification = notifications.value.find(n => n.id === id)
    if (notification) {
      notification.read = true
    }
  }

  // Mark all as read
  function markAllAsRead(): void {
    notifications.value.forEach(n => n.read = true)
  }

  // Remove notification
  function removeNotification(id: string): void {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  // Clear all notifications
  function clearAll(): void {
    notifications.value = []
  }

  // Show system notification (desktop)
  async function showSystemNotification(title: string, body: string): Promise<void> {
    try {
      await window.electronAPI.showNotification({ title, body })
    } catch (e) {
      console.error('Failed to show system notification:', e)
    }
  }

  // Getters
  const unreadCount = computed(() => 
    notifications.value.filter(n => !n.read).length
  )

  const unreadNotifications = computed(() =>
    notifications.value.filter(n => !n.read)
  )

  const recentNotifications = computed(() =>
    notifications.value.slice(0, 10)
  )

  const hasUnread = computed(() => unreadCount.value > 0)

  return {
    notifications,
    addNotification,
    notifyInfo,
    notifySuccess,
    notifyWarning,
    notifyError,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    showSystemNotification,
    unreadCount,
    unreadNotifications,
    recentNotifications,
    hasUnread
  }
})

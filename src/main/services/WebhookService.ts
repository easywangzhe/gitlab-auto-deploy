/**
 * Webhook Service - Send notifications for deployment events
 */

import { app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '../utils/logger'
import { Deployment, DeploymentStatus, GitLabProject, MergeRequest } from '../../shared/types'

export interface WebhookConfig {
  url: string
  secret?: string
  events: WebhookEventType[]
  enabled: boolean
}

export type WebhookEventType =
  | 'deployment.started'
  | 'deployment.success'
  | 'deployment.failed'
  | 'deployment.cancelled'
  | 'deployment.rollback'

export interface WebhookPayload {
  event: WebhookEventType
  timestamp: string
  data: {
    deployment: {
      id: string
      status: DeploymentStatus
      projectId: string
      startedAt: string
      completedAt?: string
      error?: string
    }
    project?: {
      id: string
      name: string
      url: string
    }
    mergeRequest?: {
      id: number
      title: string
      sourceBranch: string
      targetBranch: string
      author?: string
    }
  }
}

class WebhookService {
  private configs: WebhookConfig[] = []
  private retryAttempts = 3
  private retryDelay = 1000 // 1 second

  /**
   * Initialize webhook service
   */
  async initialize(): Promise<void> {
    await this.loadConfigs()
    logger.info('webhook', 'Webhook service initialized', {
      configCount: this.configs.filter(c => c.enabled).length
    })
  }

  /**
   * Load webhook configurations from settings
   */
  private async loadConfigs(): Promise<void> {
    const configPath = this.getConfigPath()
    try {
      const data = await fs.readFile(configPath, 'utf-8')
      this.configs = JSON.parse(data)
    } catch {
      this.configs = []
    }
  }

  /**
   * Save webhook configurations
   */
  private async saveConfigs(): Promise<void> {
    const configPath = this.getConfigPath()
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(this.configs, null, 2))
  }

  /**
   * Get config file path
   */
  private getConfigPath(): string {
    return path.join(app.getPath('userData'), 'webhooks.json')
  }

  /**
   * Add a webhook configuration
   */
  async addConfig(config: WebhookConfig): Promise<void> {
    this.configs.push(config)
    await this.saveConfigs()
    logger.info('webhook', 'Added webhook config', { url: config.url })
  }

  /**
   * Remove a webhook configuration
   */
  async removeConfig(url: string): Promise<void> {
    this.configs = this.configs.filter(c => c.url !== url)
    await this.saveConfigs()
    logger.info('webhook', 'Removed webhook config', { url })
  }

  /**
   * Get all webhook configurations
   */
  getConfigs(): WebhookConfig[] {
    return [...this.configs]
  }

  /**
   * Trigger webhook for deployment event
   */
  async trigger(
    event: WebhookEventType,
    deployment: Deployment,
    project?: GitLabProject,
    mergeRequest?: MergeRequest
  ): Promise<void> {
    const enabledConfigs = this.configs.filter(
      c => c.enabled && c.events.includes(event)
    )

    if (enabledConfigs.length === 0) {
      logger.debug('webhook', 'No enabled webhooks for event', { event })
      return
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        deployment: {
          id: deployment.id,
          status: deployment.status,
          projectId: deployment.projectId,
          startedAt: deployment.startedAt.toISOString(),
          completedAt: deployment.completedAt?.toISOString(),
          error: deployment.error
        },
        project: project ? {
          id: project.id,
          name: project.name,
          url: project.url
        } : undefined,
        mergeRequest: mergeRequest ? {
          id: mergeRequest.gitlabId,
          title: mergeRequest.title || '',
          sourceBranch: mergeRequest.sourceBranch,
          targetBranch: mergeRequest.targetBranch,
          author: mergeRequest.author
        } : undefined
      }
    }

    const results = await Promise.allSettled(
      enabledConfigs.map(config => this.sendWebhook(config, payload))
    )

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      logger.warn('webhook', 'Some webhooks failed', {
        total: enabledConfigs.length,
        failed
      })
    } else {
      logger.info('webhook', 'All webhooks sent successfully', {
        event,
        count: enabledConfigs.length
      })
    }
  }

  /**
   * Send webhook with retry logic
   */
  private async sendWebhook(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'GitLab-Auto-Deploy/1.0',
          'X-GitLab-Deploy-Event': payload.event
        }

        if (config.secret) {
          // Generate HMAC signature for payload verification
          const signature = await this.generateSignature(payload, config.secret)
          headers['X-GitLab-Deploy-Signature'] = signature
        }

        const response = await fetch(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        logger.debug('webhook', 'Webhook sent successfully', {
          url: config.url,
          event: payload.event,
          attempt
        })
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
        logger.warn('webhook', 'Webhook attempt failed', {
          url: config.url,
          attempt,
          error: lastError.message
        })

        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt) // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Webhook failed after all attempts')
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  private async generateSignature(payload: WebhookPayload, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(JSON.stringify(payload))
    )

    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Test webhook configuration
   */
  async testConfig(config: WebhookConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const testPayload: WebhookPayload = {
        event: 'deployment.started',
        timestamp: new Date().toISOString(),
        data: {
          deployment: {
            id: 'test-deployment-id',
            status: 'pending',
            projectId: 'test-project-id',
            startedAt: new Date().toISOString()
          }
        }
      }

      await this.sendWebhook({ ...config, enabled: true }, testPayload)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// Singleton instance
export const webhookService = new WebhookService()
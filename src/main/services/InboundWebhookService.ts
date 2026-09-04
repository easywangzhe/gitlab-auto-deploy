/**
 * Inbound Webhook Service - Local HTTP server that receives GitLab webhooks
 * (push / merge_request events) for instant deployment triggering,
 * eliminating polling latency.
 *
 * 接入方式：GitLab 项目 Settings > Webhooks
 *   URL:    http://<本机IP>:<port>/webhook
 *   Secret: 与应用配置一致（非必填，但强烈建议）
 *   Events: Push events + Merge request events
 */

import * as http from 'http'
import { MergeRequest } from '../../shared/types'
import { getAllProjects, getSettings } from './IPCHandlers'
import { deploymentQueue } from './DeploymentQueue'
import { logger } from '../utils/logger'
import * as crypto from 'crypto'

export interface InboundWebhookConfig {
  enabled: boolean
  port: number
  secret: string
}

class InboundWebhookService {
  private server: http.Server | null = null
  private config: InboundWebhookConfig = { enabled: false, port: 8899, secret: '' }
  private startedKey = ''

  getConfig(): InboundWebhookConfig {
    return { ...this.config }
  }

  /**
   * 与设置保持一致：启用则监听（配置变化自动重启），禁用则关闭。
   */
  async sync(config?: Partial<InboundWebhookConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config }
    }

    const key = `${this.config.enabled}|${this.config.port}|${this.config.secret}`

    if (!this.config.enabled) {
      if (this.server) {
        await this.stop()
        this.startedKey = ''
      }
      return
    }

    if (this.server && key === this.startedKey) {
      return
    }

    await this.start()
    this.startedKey = key
  }

  async start(): Promise<void> {
    if (this.server) {
      await this.stop()
    }

    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        logger.error('webhook-in', 'Unhandled webhook error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        if (!res.writableEnded) {
          res.writeHead(500)
          res.end('Internal Server Error')
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.config.port, () => {
        logger.info('webhook-in', `Inbound webhook server listening on port ${this.config.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve())
      })
      this.server = null
      logger.info('webhook-in', 'Inbound webhook server stopped')
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST' || !(req.url || '').startsWith('/webhook')) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    // Secret 校验（与 GitLab Webhook 的 Secret Token 一致）
    if (this.config.secret) {
      const token = (req.headers['x-gitlab-token'] as string) || ''
      if (token !== this.config.secret) {
        logger.warn('webhook-in', 'Rejected webhook: invalid secret token')
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }
    }

    // 读取请求体（上限 1MB）
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 1024 * 1024) {
        res.writeHead(413)
        res.end('Payload Too Large')
        return
      }
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    try {
      const triggered = await this.dispatch(payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, triggered }))
    } catch (error) {
      logger.error('webhook-in', 'Failed to dispatch webhook', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  }

  /**
   * 解析 GitLab payload 并触发匹配项目的部署。
   * 返回实际触发的部署数量。
   */
  private async dispatch(payload: Record<string, unknown>): Promise<number> {
    const gitlabProjectId = (payload.project as Record<string, unknown>)?.id as number | undefined
    const kind = payload.object_kind as string | undefined

    let branch = ''
    let sha = ''
    let title = ''
    let mrIid = 0

    if (kind === 'push') {
      const ref = (payload.ref as string) || ''
      branch = ref.replace(/^refs\/heads\//, '')
      sha = (payload.checkout_sha as string) ||
        (payload.after as string) ||
        ((payload.commits as Array<{ id: string; message: string }>)?.[0]?.id) ||
        ''
      const firstMsg = (payload.commits as Array<{ message: string }>)?.[0]?.message || ''
      title = `Webhook push: ${firstMsg.split('\n')[0] || 'New commit'}`
    } else if (kind === 'merge_request') {
      const attrs = (payload.object_attributes || {}) as Record<string, unknown>
      // 仅合并后触发
      if (attrs.state !== 'merged') {
        logger.debug('webhook-in', 'Ignoring non-merged MR webhook', { state: String(attrs.state) })
        return 0
      }
      branch = (attrs.target_branch as string) || ''
      sha = (attrs.merge_commit_sha as string) ||
        ((attrs.last_commit as Record<string, unknown>)?.id as string) ||
        ''
      title = `Webhook MR: ${(attrs.title as string) || 'Merged'}`
      mrIid = (attrs.iid as number) || 0
    } else {
      // 其他事件类型（issue/note/pipeline 等）忽略
      return 0
    }

    if (!gitlabProjectId || !branch) {
      logger.debug('webhook-in', 'Webhook missing project id or branch', { gitlabProjectId, branch })
      return 0
    }

    // 匹配：gitlabId 一致 + 开启自动部署 + 监听该分支
    const targets = getAllProjects().filter(
      (p) => p.gitlabId === gitlabProjectId && p.autoDeploy && (p.branch || 'main') === branch
    )

    if (targets.length === 0) {
      logger.debug('webhook-in', 'No matching project for webhook', { gitlabProjectId, branch })
      return 0
    }

    let triggered = 0
    for (const project of targets) {
      const user = payload.user as Record<string, unknown> | undefined
      const mr: MergeRequest = {
        id: crypto.randomUUID(),
        gitlabId: mrIid,
        sourceBranch: branch,
        targetBranch: branch,
        state: 'merged' as const,
        title,
        author: (user?.name as string) || (user?.username as string),
        projectId: project.id,
        sha: sha || undefined,
        mergedAt: new Date()
      }

      try {
        await deploymentQueue.enqueue(project, mr)
        triggered++
        logger.info('webhook-in', `Webhook triggered deployment for ${project.name}`, {
          projectId: project.id,
          branch,
          sha: sha?.substring(0, 7)
        })
      } catch (error) {
        logger.error('webhook-in', `Failed to enqueue deployment for ${project.name}`, {
          projectId: project.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return triggered
  }
}

// Singleton instance
export const inboundWebhookService = new InboundWebhookService()

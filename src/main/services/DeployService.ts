/**
 * Deploy Service - SSH upload, backup, health check, and rollback
 */

import { Client, ConnectConfig } from 'ssh2'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as http from 'http'
import * as https from 'https'
import {
  Deployment,
  DeploymentStatusEnum,
  DeploymentArtifact,
  Server,
  SSHCredentials,
  HealthCheck,
  MergeRequest
} from '../../shared/types'
import { logger } from '../utils/logger'
import { app } from 'electron'
import * as crypto from 'crypto'

/** 健康检查遇到重定向时抛出，由外层循环跟随 */
class RedirectError extends Error {
  url: string
  constructor(url: string) {
    super(`Redirect to ${url}`)
    this.url = url
  }
}

export class DeployService {
  private deployments: Map<string, Deployment> = new Map()
  private deploymentsPath: string | null = null

  private getDeploymentsPath(): string {
    if (!this.deploymentsPath) {
      this.deploymentsPath = path.join(app.getPath('userData'), 'data', 'deployments')
    }
    return this.deploymentsPath
  }

  /**
   * Ensure deployments directory exists
   */
  private async ensureDeploymentsDir(): Promise<void> {
    await fs.mkdir(this.getDeploymentsPath(), { recursive: true })
  }

  /**
   * Save deployment to disk
   */
  async saveDeployment(deployment: Deployment): Promise<void> {
    try {
      await this.ensureDeploymentsDir()
      const filePath = path.join(this.getDeploymentsPath(), `${deployment.id}.json`)
      await fs.writeFile(filePath, JSON.stringify(deployment, null, 2))
    } catch (error) {
      logger.error('deploy', 'Failed to save deployment', {
        deploymentId: deployment.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Load all deployments from disk
   */
  async loadDeployments(): Promise<void> {
    try {
      const deployPath = this.getDeploymentsPath()
      await this.ensureDeploymentsDir()

      const files = await fs.readdir(deployPath)
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = await fs.readFile(path.join(deployPath, file), 'utf-8')
            const parsed = JSON.parse(data)

            // Convert date strings to Date objects
            if (parsed.startedAt) parsed.startedAt = new Date(parsed.startedAt)
            if (parsed.completedAt) parsed.completedAt = new Date(parsed.completedAt)
            if (parsed.logs && Array.isArray(parsed.logs)) {
              parsed.logs = parsed.logs.map((log: { timestamp: string | Date }) => ({
                ...log,
                timestamp: log.timestamp ? new Date(log.timestamp) : new Date()
              }))
            }

            this.deployments.set(parsed.id, parsed)
          } catch (error) {
            logger.error('deploy', `Failed to load deployment file: ${file}`, {
              error: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      }

      logger.info('deploy', `Loaded ${this.deployments.size} deployments from disk`)
    } catch (error) {
      logger.error('deploy', 'Failed to load deployments', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async startDeployment(
    projectId: string,
    mr: MergeRequest
  ): Promise<Deployment> {
    const deploymentId = crypto.randomUUID()

    const deployment: Deployment = {
      id: deploymentId,
      projectId,
      artifactId: '',
      serverId: '',
      mergeRequestId: mr.id,
      status: DeploymentStatusEnum.enum.pending,
      startedAt: new Date(),
      logs: []
    }

    this.deployments.set(deploymentId, deployment)
    await this.saveDeployment(deployment)

    logger.info('deploy', `Started deployment ${deploymentId}`, {
      projectId,
      mrId: mr.gitlabId
    })

    return deployment
  }

  async updateDeploymentStatus(
    deploymentId: string,
    status: Deployment['status']
  ): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (deployment) {
      deployment.status = status
      this.deployments.set(deploymentId, deployment)
      await this.saveDeployment(deployment)
      logger.info('deploy', `Deployment ${deploymentId} status: ${status}`)
    }
  }

  async addDeploymentLog(
    deploymentId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string
  ): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (deployment) {
      deployment.logs.push({
        timestamp: new Date(),
        level,
        message
      })
      await this.saveDeployment(deployment)
    }
  }

  private async connectSSH(
    server: Server,
    credentials: SSHCredentials
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client()

      const config: ConnectConfig = {
        host: server.host,
        port: server.port,
        username: server.username
      }

      // Handle different authentication types
      if (credentials.authType === 'password' && credentials.password) {
        config.password = credentials.password
      } else if (credentials.privateKey) {
        config.privateKey = credentials.privateKey
        if (credentials.passphrase) {
          config.passphrase = credentials.passphrase
        }
      } else {
        reject(new Error('No valid SSH credentials provided'))
        return
      }

      client.on('ready', () => resolve(client))
      client.on('error', reject)

      client.connect(config)
    })
  }

  async uploadArtifact(
    artifact: DeploymentArtifact,
    server: Server,
    credentials: SSHCredentials,
    deployPath: string
  ): Promise<void> {
    logger.info('deploy', `Uploading artifact to ${server.host}`)

    const client = await this.connectSSH(server, credentials)

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end()
          reject(err)
          return
        }

        // Ensure deploy directory exists (don't delete existing files)
        client.exec(
          `mkdir -p ${deployPath}`,
          (err, stream) => {
            if (err) {
              client.end()
              reject(err)
              return
            }

            // Must read stream data to prevent blocking
            stream.on('data', () => {})
            stream.stderr.on('data', () => {})

            stream.on('close', async (code: number | null) => {
              if (code !== 0 && code !== null) {
                client.end()
                reject(new Error(`Failed to create deploy directory`))
                return
              }

              // Upload files (will overwrite existing ones)
              try {
                await this.uploadDirectory(
                  sftp,
                  artifact.path,
                  deployPath
                )
                client.end()
                logger.info('deploy', 'Upload completed')
                resolve()
              } catch (error) {
                client.end()
                reject(error)
              }
            })

            stream.on('error', (err: Error) => {
              client.end()
              reject(err)
            })
          }
        )
      })
    })
  }

  private async uploadDirectory(
    sftp: import('ssh2').SFTPWrapper,
    localPath: string,
    remotePath: string
  ): Promise<void> {
    const entries = await fs.readdir(localPath, { withFileTypes: true })

    for (const entry of entries) {
      const localFile = path.join(localPath, entry.name)
      const remoteFile = `${remotePath}/${entry.name}`

      if (entry.isDirectory()) {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(remoteFile, (err) => {
            // Ignore error if directory exists
            resolve()
          })
        })
        await this.uploadDirectory(sftp, localFile, remoteFile)
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.fastPut(localFile, remoteFile, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      }
    }
  }

  async healthCheck(url: string, config: HealthCheck): Promise<boolean> {
    const MAX_REDIRECTS = 5
    let currentUrl = url

    for (let attempt = 0; attempt <= config.retryCount; attempt++) {
      if (attempt > 0) {
        logger.info('deploy', `Health check retry ${attempt}/${config.retryCount}`)
        await new Promise((r) => setTimeout(r, config.retryInterval))
      }

      try {
        let redirects = 0
        // 每次尝试内可跟随有限次重定向（防重定向环导致无限递归）
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            const ok = await this.checkHealthOnce(currentUrl, config)
            if (ok) {
              logger.info('deploy', `Health check passed: ${currentUrl}`)
              return true
            }
            break // 非重定向的响应但状态码不匹配 → 进入下一次 retry
          } catch (error) {
            if (error instanceof RedirectError) {
              if (redirects >= MAX_REDIRECTS) {
                throw new Error(`Health check exceeded ${MAX_REDIRECTS} redirects`)
              }
              currentUrl = error.url
              redirects++
              continue
            }
            throw error
          }
        }
      } catch (error) {
        logger.warn('deploy', `Health check attempt ${attempt + 1} failed`, {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.error('deploy', `Health check failed after ${config.retryCount + 1} attempts`)
    return false
  }

  /**
   * 单次健康检查请求：返回状态码是否匹配；遇到重定向抛 RedirectError
   */
  private checkHealthOnce(url: string, config: HealthCheck): Promise<boolean> {
    const urlObj = new URL(url)
    const httpClient = urlObj.protocol === 'https:' ? https : http

    return new Promise<boolean>((resolve, reject) => {
      const req = httpClient.get(
        url,
        { timeout: config.timeout },
        (res) => {
          // 排空响应体，避免连接挂起
          res.resume()
          // Handle redirects (301, 302, 303, 307, 308)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString()
            logger.info('deploy', `Health check redirect to ${redirectUrl}`)
            reject(new RedirectError(redirectUrl))
            return
          }
          resolve(res.statusCode === config.expectedStatusCode)
        }
      )

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Health check timeout'))
      })
    })
  }

  getDeploymentStatus(deploymentId: string): Deployment | null {
    return this.deployments.get(deploymentId) || null
  }

  getDeployment(deploymentId: string): Deployment | undefined {
    return this.deployments.get(deploymentId)
  }

  getAllDeployments(): Deployment[] {
    return Array.from(this.deployments.values())
  }

  getDeploymentsByProject(projectId: string): Deployment[] {
    return Array.from(this.deployments.values()).filter(d => d.projectId === projectId)
  }

  async deleteDeployment(deploymentId: string): Promise<boolean> {
    try {
      const deployment = this.deployments.get(deploymentId)
      if (!deployment) {
        return false
      }

      // Remove from memory
      this.deployments.delete(deploymentId)

      // Delete file from disk
      const filePath = path.join(this.getDeploymentsPath(), `${deploymentId}.json`)
      await fs.unlink(filePath)

      logger.info('deploy', 'Deployment deleted', { deploymentId })
      return true
    } catch (error) {
      logger.error('deploy', 'Failed to delete deployment', {
        deploymentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return false
    }
  }

  async updateProgress(deploymentId: string, progress: number): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (deployment) {
      deployment.progress = Math.min(100, Math.max(0, progress))
      this.deployments.set(deploymentId, deployment)
      await this.saveDeployment(deployment)
    }
  }

  async completeDeployment(deploymentId: string, success: boolean, error?: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (deployment) {
      deployment.status = success
        ? DeploymentStatusEnum.enum.success
        : DeploymentStatusEnum.enum.failed
      deployment.completedAt = new Date()
      deployment.progress = 100
      if (error) {
        deployment.error = error
      }
      this.deployments.set(deploymentId, deployment)
      await this.saveDeployment(deployment)
    }
  }
}

// Singleton instance
export const deployService = new DeployService()
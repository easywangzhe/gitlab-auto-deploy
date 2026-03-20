/**
 * Credential Service - AES-256-GCM encrypted credential storage
 */

import { app, safeStorage } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  GitLabAPIToken,
  SSHCredentials,
  GitLabAPITokenSchema,
  SSHCredentialsSchema
} from '../../shared/types'
import { logger } from '../utils/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

interface EncryptedData {
  iv: string
  authTag: string
  encrypted: string
}

export class CredentialService {
  private credentialsPath: string
  private encryptionKey: Buffer | null = null

  constructor() {
    this.credentialsPath = path.join(app.getPath('userData'), 'credentials')
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.credentialsPath, { recursive: true })
  }

  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) {
      return this.encryptionKey
    }

    // Use Electron's safeStorage to derive a key
    const keyPath = path.join(this.credentialsPath, '.key')
    try {
      const encryptedKey = await fs.readFile(keyPath)
      this.encryptionKey = Buffer.from(safeStorage.decryptString(encryptedKey))
    } catch {
      // Generate new key if not exists
      const newKey = crypto.randomBytes(32)
      const encryptedKey = safeStorage.encryptString(newKey.toString('base64'))
      await this.ensureDirectory()
      await fs.writeFile(keyPath, encryptedKey)
      this.encryptionKey = newKey
    }

    return this.encryptionKey!
  }

  private async encrypt(plaintext: string): Promise<EncryptedData> {
    const key = await this.getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    let encrypted = cipher.update(plaintext, 'utf8', 'base64')
    encrypted += cipher.final('base64')

    const authTag = cipher.getAuthTag()

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encrypted
    }
  }

  private async decrypt(data: EncryptedData): Promise<string> {
    const key = await this.getEncryptionKey()
    const iv = Buffer.from(data.iv, 'base64')
    const authTag = Buffer.from(data.authTag, 'base64')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(data.encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  }

  private getGitLabTokenPath(projectId: string): string {
    return path.join(this.credentialsPath, `gitlab-${projectId}.json`)
  }

  private getSSHCredentialsPath(id: string): string {
    return path.join(this.credentialsPath, `ssh-${id}.json`)
  }

  async storeGitLabToken(projectId: string, token: GitLabAPIToken): Promise<void> {
    await this.ensureDirectory()
    const tokenPath = this.getGitLabTokenPath(projectId)

    const tokenData = JSON.stringify({
      value: token.value,
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt?.toISOString()
    })

    const encrypted = await this.encrypt(tokenData)
    await fs.writeFile(tokenPath, JSON.stringify(encrypted))

    logger.info('credentials', `GitLab token stored for project ${projectId}`)
  }

  async getGitLabToken(projectId: string): Promise<GitLabAPIToken | null> {
    const tokenPath = this.getGitLabTokenPath(projectId)

    try {
      const data = await fs.readFile(tokenPath, 'utf8')
      const encrypted: EncryptedData = JSON.parse(data)
      const decrypted = await this.decrypt(encrypted)
      const parsed = JSON.parse(decrypted)

      return GitLabAPITokenSchema.parse({
        value: parsed.value,
        createdAt: new Date(parsed.createdAt),
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined
      })
    } catch (error) {
      logger.warn('credentials', `Failed to get GitLab token for project ${projectId}`, { error })
      return null
    }
  }

  async storeSSHCredentials(credentials: SSHCredentials): Promise<void> {
    await this.ensureDirectory()
    const sshPath = this.getSSHCredentialsPath(credentials.id)

    const credData = JSON.stringify({
      id: credentials.id,
      authType: credentials.authType || 'privateKey',
      privateKey: credentials.privateKey,
      passphrase: credentials.passphrase,
      password: credentials.password
    })

    const encrypted = await this.encrypt(credData)
    await fs.writeFile(sshPath, JSON.stringify(encrypted))

    logger.info('credentials', `SSH credentials stored: ${credentials.id}`)
  }

  async getSSHCredentials(id: string): Promise<SSHCredentials | null> {
    const sshPath = this.getSSHCredentialsPath(id)

    try {
      const data = await fs.readFile(sshPath, 'utf8')
      const encrypted: EncryptedData = JSON.parse(data)
      const decrypted = await this.decrypt(encrypted)
      const parsed = JSON.parse(decrypted)

      return SSHCredentialsSchema.parse({
        id: parsed.id,
        authType: parsed.authType || 'privateKey',
        privateKey: parsed.privateKey,
        passphrase: parsed.passphrase,
        password: parsed.password
      })
    } catch (error) {
      logger.warn('credentials', `Failed to get SSH credentials ${id}`, { error })
      return null
    }
  }

  async deleteCredentials(id: string): Promise<void> {
    const gitlabPath = this.getGitLabTokenPath(id)
    const sshPath = this.getSSHCredentialsPath(id)

    try {
      await fs.unlink(gitlabPath)
    } catch {
      // File may not exist
    }

    try {
      await fs.unlink(sshPath)
    } catch {
      // File may not exist
    }

    logger.info('credentials', `Credentials deleted: ${id}`)
  }

  async testGitLabConnection(apiUrl: string, token: string): Promise<boolean> {
    try {
      const response = await fetch(`${apiUrl}/api/v4/user`, {
        headers: {
          'Private-Token': token
        }
      })

      return response.ok
    } catch (error) {
      logger.error('credentials', 'GitLab connection test failed', { error, apiUrl })
      return false
    }
  }

  async testSSHConnection(
    host: string,
    port: number,
    username: string,
    authType: 'privateKey' | 'password' = 'privateKey',
    privateKey?: string,
    password?: string
  ): Promise<boolean> {
    const { Client } = await import('ssh2')

    return new Promise((resolve) => {
      const client = new Client()

      client.on('ready', () => {
        client.end()
        resolve(true)
      })

      client.on('error', (error) => {
        logger.error('credentials', 'SSH connection test failed', { error, host, port })
        resolve(false)
      })

      const connectConfig: {
        host: string
        port: number
        username: string
        privateKey?: string
        passphrase?: string
        password?: string
      } = {
        host,
        port,
        username
      }

      if (authType === 'privateKey') {
        connectConfig.privateKey = privateKey
      } else {
        connectConfig.password = password
      }

      client.connect(connectConfig)

      // Timeout after 10 seconds
      setTimeout(() => {
        client.end()
        resolve(false)
      }, 10000)
    })
  }
}

// Singleton instance
export const credentialService = new CredentialService()
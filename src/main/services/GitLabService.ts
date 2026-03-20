/**
 * GitLab Service - Poll GitLab API for merged MRs
 */

import { Gitlab } from '@gitbeaker/rest'
import {
  GitLabConnection,
  MergeRequest,
  MergeRequestStateEnum,
  GitLabProjectResponse,
  GitLabProjectResponseSchema,
  MergeRequestSchema
} from '../../shared/types'
import { logger } from '../utils/logger'

export class GitLabService {
  private api: InstanceType<typeof Gitlab> | null = null
  private config: GitLabConnection | null = null
  private pollingInterval: NodeJS.Timeout | null = null
  private lastCheckTimes: Map<string, Date> = new Map()
  private lastKnownShas: Map<string, string> = new Map()

  async connect(config: GitLabConnection): Promise<void> {
    this.config = config

    // Ensure apiUrl doesn't have trailing slash
    const apiUrl = config.apiUrl.replace(/\/+$/, '')

    logger.info('gitlab', `Connecting to GitLab at ${apiUrl}`, {
      tokenLength: config.token?.length || 0,
      tokenPrefix: config.token?.substring(0, 4) + '...'
    })

    this.api = new Gitlab({
      host: apiUrl,
      token: config.token
    })

    logger.info('gitlab', `Connected to GitLab at ${config.apiUrl}`)

    // Test connection
    try {
      await this.api.Users.showCurrentUser()
      logger.info('gitlab', 'GitLab connection verified')
    } catch (error) {
      logger.error('gitlab', 'Failed to verify GitLab connection', { error })
      throw error
    }
  }

  startPolling(
    onMergedMR: (projectId: string, mr: MergeRequest) => void
  ): void {
    if (!this.api || !this.config) {
      throw new Error('GitLab not connected')
    }

    const poll = async () => {
      try {
        logger.debug('gitlab', 'Polling for merged MRs')

        // This would be called by the deployment coordinator
        // which knows which projects to poll
      } catch (error) {
        logger.error('gitlab', 'Polling error', { error })
      }
    }

    this.pollingInterval = setInterval(poll, this.config.pollingInterval)
    logger.info('gitlab', `Started polling every ${this.config.pollingInterval}ms`)
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      logger.info('gitlab', 'Stopped polling')
    }
  }

  async fetchProjects(): Promise<GitLabProjectResponse[]> {
    if (!this.api) {
      throw new Error('GitLab not connected')
    }

    try {
      const projects = await this.api.Projects.all({
        membership: true,
        perPage: 100
      })

      return projects.map((p) =>
        GitLabProjectResponseSchema.parse({
          id: p.id,
          name: p.name,
          path_with_namespace: p.path_with_namespace,
          web_url: p.web_url,
          ssh_url_to_repo: p.ssh_url_to_repo,
          http_url_to_repo: p.http_url_to_repo
        })
      )
    } catch (error) {
      logger.error('gitlab', 'Failed to fetch projects', { error })
      throw error
    }
  }

  async fetchMergeRequests(
    projectId: string,
    targetBranch: string
  ): Promise<MergeRequest[]> {
    if (!this.api) {
      throw new Error('GitLab not connected')
    }

    const numericProjectId = parseInt(projectId, 10)
    logger.info('gitlab', `Fetching merge requests`, {
      projectId: numericProjectId,
      targetBranch,
      apiUrl: this.config?.apiUrl
    })

    try {
      const mrs = await this.api.MergeRequests.all({
        projectId: numericProjectId,
        targetBranch,
        state: 'merged',
        perPage: 50
      })

      return mrs.map((mr) =>
        MergeRequestSchema.parse({
          id: crypto.randomUUID(),
          gitlabId: mr.id,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          state: MergeRequestStateEnum.enum.merged,
          mergedAt: mr.merged_at ? new Date(mr.merged_at) : undefined,
          title: mr.title,
          author: mr.author?.username,
          projectId,
          sha: mr.merge_commit_sha
        })
      )
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string; response?: unknown }
      logger.error('gitlab', 'Failed to fetch merge requests', {
        projectId,
        status: err?.status,
        message: err?.message,
        response: err?.response
      })
      throw error
    }
  }

  /**
   * Check for new commits on a branch (supports direct push/merge)
   * Uses commit SHA tracking to detect changes reliably
   */
  async checkBranchCommits(
    projectId: string,
    branch: string,
    lastCheckTime: Date
  ): Promise<{ hasNewCommits: boolean; latestCommit: { sha: string; message: string; authoredAt: Date } | null }> {
    if (!this.api) {
      throw new Error('GitLab not connected')
    }

    const numericProjectId = parseInt(projectId, 10)

    try {
      const commits = await this.api.Commits.all(numericProjectId, {
        refName: branch,
        perPage: 10
      })

      if (!commits || commits.length === 0) {
        return { hasNewCommits: false, latestCommit: null }
      }

      // Get the latest commit
      const latestCommit = commits[0]
      const authoredDate = new Date(latestCommit.authored_date || latestCommit.created_at)
      const latestSha = latestCommit.id

      // Check if this is a new commit by comparing SHA with the last known one
      const lastKnownSha = this.lastKnownShas.get(`${projectId}-${branch}`)
      const isNewSha = lastKnownSha && lastKnownSha !== latestSha

      // Also check by time as a fallback (for first run or if SHA tracking fails)
      const isNewByTime = authoredDate > lastCheckTime

      // Update the last known SHA
      this.lastKnownShas.set(`${projectId}-${branch}`, latestSha)

      const hasNewCommits = isNewSha || isNewByTime

      logger.debug('gitlab', 'Checking branch commits', {
        projectId,
        branch,
        latestCommitSha: latestSha,
        lastKnownSha: lastKnownSha || 'none',
        latestCommitMessage: latestCommit.message?.trim(),
        authoredAt: authoredDate.toISOString(),
        lastCheckTime: lastCheckTime.toISOString(),
        isNewSha,
        isNewByTime,
        hasNewCommits
      })

      return {
        hasNewCommits,
        latestCommit: {
          sha: latestSha,
          message: latestCommit.message,
          authoredAt: authoredDate
        }
      }
    } catch (error) {
      logger.error('gitlab', 'Failed to check branch commits', {
        projectId,
        branch,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async checkMergedMRs(
    projectId: string,
    targetBranch: string,
    lastCheckTime: Date
  ): Promise<MergeRequest[]> {
    const mrs = await this.fetchMergeRequests(projectId, targetBranch)

    // Log all fetched MRs for debugging
    if (mrs.length > 0) {
      logger.debug('gitlab', `Fetched ${mrs.length} merged MRs`, {
        projectId,
        targetBranch,
        lastCheckTime: lastCheckTime.toISOString(),
        mrs: mrs.map(mr => ({
          id: mr.gitlabId,
          title: mr.title,
          mergedAt: mr.mergedAt?.toISOString(),
          sourceBranch: mr.sourceBranch
        }))
      })
    }

    // Filter to only return MRs merged after last check time
    const newMerged = mrs.filter((mr) => {
      if (!mr.mergedAt) return false
      const mergedDate = new Date(mr.mergedAt)
      const isNew = mergedDate > lastCheckTime
      if (!isNew) {
        logger.debug('gitlab', `MR "${mr.title}" filtered out (mergedAt: ${mergedDate.toISOString()} <= lastCheckTime: ${lastCheckTime.toISOString()})`)
      }
      return isNew
    })

    logger.info('gitlab', `Found ${newMerged.length} newly merged MRs`, {
      projectId,
      targetBranch
    })

    return newMerged
  }

  getLastCheckTime(projectId: string): Date {
    return this.lastCheckTimes.get(projectId) || new Date(0)
  }

  setLastCheckTime(projectId: string, time: Date): void {
    this.lastCheckTimes.set(projectId, time)
  }

  /**
   * 获取分支的 commit 列表（用于回滚选择）
   */
  async getBranchCommits(
    projectId: string,
    branch: string,
    limit: number = 20
  ): Promise<Array<{ sha: string; shortSha: string; message: string; author: string; authoredAt: Date }>> {
    if (!this.api) {
      throw new Error('GitLab not connected')
    }

    const numericProjectId = parseInt(projectId, 10)
    const commits = await this.api.Commits.all(numericProjectId, {
      refName: branch,
      perPage: limit
    })

    return commits.map((commit) => ({
      sha: commit.id,
      shortSha: commit.short_id || commit.id.substring(0, 7),
      message: commit.message || '',
      author: commit.author_name || '',
      authoredAt: new Date(commit.authored_date || commit.created_at)
    }))
  }
}

// Add crypto import for uuid
import * as crypto from 'crypto'

// Singleton instance
export const gitLabService = new GitLabService()
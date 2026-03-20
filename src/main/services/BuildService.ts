/**
 * Build Service - Clone, install dependencies, and build projects
 */

import { app } from 'electron'
import execa from 'execa'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  GitLabProject,
  PackageManager,
  BuildJob,
  BuildJobStatusEnum,
  DeploymentArtifact,
  DeploymentArtifactSchema
} from '../../shared/types'
import { logger } from '../utils/logger'

export class BuildService {
  private workspacePath: string

  constructor() {
    this.workspacePath = path.join(app.getPath('userData'), 'workspace')
  }

  private getProjectPath(projectId: string): string {
    return path.join(this.workspacePath, projectId)
  }

  private async ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Clone a project repository
   * @param project - The project to clone
   * @param branch - The branch to clone
   * @param gitlabUrl - The GitLab server URL (e.g., https://gitlab.com)
   * @param token - Optional GitLab token for authentication
   * @param commitSha - Optional commit SHA to checkout (for rollback)
   */
  async clone(
    project: GitLabProject,
    branch: string,
    gitlabUrl?: string,
    token?: string,
    commitSha?: string
  ): Promise<string> {
    const projectPath = this.getProjectPath(project.id)

    // Check if already cloned
    try {
      await fs.access(projectPath)
      // Pull latest changes
      logger.info('build', `Pulling latest changes for project ${project.id}`)

      await execa('git', ['fetch', 'origin'], { cwd: projectPath })

      if (commitSha) {
        // 回滚模式：checkout 到指定 commit
        logger.info('build', `Checking out commit ${commitSha} for rollback`)
        await execa('git', ['checkout', commitSha], { cwd: projectPath })
      } else {
        // 正常模式：checkout branch 并 pull
        await execa('git', ['checkout', branch], { cwd: projectPath })
        await execa('git', ['pull', 'origin', branch], { cwd: projectPath })
      }
    } catch {
      // Clone fresh
      logger.info('build', `Cloning project ${project.id}`)

      await this.ensureDirectory(this.workspacePath)

      // Construct clone URL using gitlabUrl + gitlabPath
      // Priority: gitlabUrl parameter > project.url
      let cloneUrl: string

      if (gitlabUrl) {
        // Use provided GitLab URL with project path
        const apiUrl = gitlabUrl.replace(/\/+$/, '')
        // Use OAuth2 token authentication if provided
        // Correct format: http://oauth2:TOKEN@host:port/path.git
        if (token) {
          const urlObj = new URL(apiUrl)
          cloneUrl = `${urlObj.protocol}//oauth2:${token}@${urlObj.host}/${project.gitlabPath}.git`
        } else {
          cloneUrl = `${apiUrl}/${project.gitlabPath}.git`
        }
      } else if (project.url) {
        // Fallback to project.url if available
        const parsedUrl = new URL(project.url)
        if (token) {
          cloneUrl = `https://oauth2:${token}@${parsedUrl.host}${parsedUrl.pathname}.git`
        } else {
          cloneUrl = `${project.url}.git`
        }
      } else {
        throw new Error('GitLab URL is required. Please configure GitLab connection in settings.')
      }

      logger.info('build', `Cloning from ${cloneUrl.replace(/oauth2:[^@]+@/, 'oauth2:***@')}`)

      await execa('git', ['clone', '-b', branch, cloneUrl, projectPath])

      if (commitSha) {
        // 克隆后 checkout 到指定 commit
        logger.info('build', `Checking out commit ${commitSha} after clone`)
        await execa('git', ['checkout', commitSha], { cwd: projectPath })
      }
    }

    return projectPath
  }

  async detectPackageManager(projectPath: string): Promise<PackageManager> {
    // First, check package.json for packageManager field or preinstall script requiring pnpm
    try {
      const packageJsonPath = path.join(projectPath, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf8')
      const packageJson = JSON.parse(content)

      // Check for 'packageManager' field (Node.js Corepack standard)
      if (packageJson.packageManager) {
        const pm = packageJson.packageManager as string
        if (pm.startsWith('pnpm')) {
          logger.info('build', 'Detected package manager from packageManager field: pnpm')
          return 'pnpm'
        } else if (pm.startsWith('yarn')) {
          logger.info('build', 'Detected package manager from packageManager field: yarn')
          return 'yarn'
        } else if (pm.startsWith('npm')) {
          logger.info('build', 'Detected package manager from packageManager field: npm')
          return 'npm'
        }
      }

      // Check for 'preinstall' script requiring pnpm (e.g., "npx only-allow pnpm")
      const preinstall = packageJson.scripts?.preinstall as string | undefined
      if (preinstall?.includes('only-allow pnpm') || preinstall?.includes('only-allowpnpm')) {
        logger.info('build', 'Detected pnpm requirement from preinstall script')
        return 'pnpm'
      }
    } catch {
      // Ignore errors, fall back to lock file detection
    }

    // Fall back to lock file detection
    const lockFiles: Record<string, PackageManager> = {
      'pnpm-lock.yaml': 'pnpm',
      'yarn.lock': 'yarn',
      'package-lock.json': 'npm'
    }

    for (const [file, manager] of Object.entries(lockFiles)) {
      try {
        await fs.access(path.join(projectPath, file))
        logger.info('build', `Detected package manager: ${manager}`)
        return manager
      } catch {
        continue
      }
    }

    // Default to pnpm for modern projects
    logger.info('build', 'No lock file found, defaulting to pnpm')
    return 'pnpm'
  }

  async installDependencies(
    projectPath: string,
    packageManager: PackageManager
  ): Promise<void> {
    logger.info('build', `Installing dependencies with ${packageManager}`)

    // Use --ignore-scripts to skip lifecycle scripts (husky, etc.) that may fail in CI/deploy environments
    const commands: Record<PackageManager, string[]> = {
      npm: ['npm', 'install', '--ignore-scripts'],
      yarn: ['yarn', 'install', '--ignore-scripts'],
      pnpm: ['pnpm', 'install', '--ignore-scripts']
    }

    const [cmd, ...args] = commands[packageManager]

    await execa(cmd, args, {
      cwd: projectPath,
      timeout: 300000 // 5 minutes timeout for install
    })
  }

  async detectBuildCommand(projectPath: string): Promise<string | null> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf8')
      const packageJson = JSON.parse(content)

      const scripts = packageJson.scripts || {}

      // Priority order
      const buildCommands = ['build', 'build:prod', 'build:production', 'dist']

      for (const cmd of buildCommands) {
        if (scripts[cmd]) {
          logger.info('build', `Detected build command: ${cmd}`)
          return cmd
        }
      }

      return null
    } catch (error) {
      logger.error('build', 'Failed to detect build command', { error })
      return null
    }
  }

  async build(
    projectPath: string,
    command: string,
    timeout: number = 600000
  ): Promise<BuildJob> {
    const jobId = crypto.randomUUID()
    const startTime = new Date()

    logger.info('build', `Starting build job ${jobId}`, { command, timeout })

    const job: BuildJob = {
      id: jobId,
      projectId: '',
      mergeRequestId: '',
      status: BuildJobStatusEnum.enum.running,
      startTime,
      timeout,
      logs: []
    }

    try {
      const result = await execa('npm', ['run', command], {
        cwd: projectPath,
        timeout,
        all: true
      })

      // Wait a moment for file system to sync (especially for background processes in build scripts)
      await new Promise(resolve => setTimeout(resolve, 1000))

      job.status = BuildJobStatusEnum.enum.success
      job.endTime = new Date()
      job.exitCode = result.exitCode
      job.logs = result.all ? result.all.split('\n') : []

      logger.info('build', `Build job ${jobId} completed successfully`)
    } catch (error: unknown) {
      const execError = error as { exitCode?: number; message?: string; all?: string }
      job.status = BuildJobStatusEnum.enum.failed
      job.endTime = new Date()
      job.exitCode = execError.exitCode
      job.error = execError.message || 'Build failed'
      job.logs = execError.all ? execError.all.split('\n') : []

      logger.error('build', `Build job ${jobId} failed`, { error })
    }

    return job
  }

  /**
   * Get build output artifact
   * @param projectPath - The project root path
   * @param customOutputDir - Optional custom output directory (from project config)
   */
  async getBuildOutput(projectPath: string, customOutputDir?: string): Promise<DeploymentArtifact> {
    // If custom output dir is specified, try it first
    const outputDirs = customOutputDir
      ? [customOutputDir, 'dist', 'build', 'out', '.output', 'public']
      : ['dist', 'build', 'out', '.output', 'public']

    logger.info('build', `Looking for build output in ${projectPath}`, { outputDirs, customOutputDir })

    for (const dir of outputDirs) {
      const outputPath = path.join(projectPath, dir)
      logger.info('build', `Checking directory: ${outputPath}`)

      try {
        const stats = await fs.stat(outputPath)
        logger.info('build', `Stat result for ${outputPath}: isDirectory=${stats.isDirectory()}`)

        if (stats.isDirectory()) {
          logger.info('build', `Found directory: ${outputPath}`)
          const files = await this.listFiles(outputPath)
          logger.info('build', `Files found in ${dir}: ${files.length}`)

          if (files.length === 0) {
            logger.warn('build', `Output directory ${dir} is empty, trying next...`)
            continue
          }

          const totalSize = await this.getTotalSize(outputPath)
          logger.info('build', `Found build output in ${dir} with ${files.length} files`)

          return DeploymentArtifactSchema.parse({
            id: crypto.randomUUID(),
            buildJobId: crypto.randomUUID(), // Generate valid UUID for build tracking
            path: outputPath,
            fileCount: files.length,
            totalSize,
            createdAt: new Date()
          })
        }
      } catch (err) {
        logger.info('build', `Directory ${dir} not accessible: ${err instanceof Error ? err.message : 'unknown error'}`)
        continue
      }
    }

    // Log all checked paths for debugging
    const checkedPaths = outputDirs.map(dir => path.join(projectPath, dir))
    logger.error('build', `No build output directory found. Checked paths: ${checkedPaths.join(', ')}`)
    throw new Error(`No build output directory found. Checked: ${outputDirs.join(', ')}`)
  }

  private async listFiles(dir: string): Promise<string[]> {
    const files: string[] = []

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await this.listFiles(fullPath)
        files.push(...subFiles)
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  private async getTotalSize(dir: string): Promise<number> {
    let totalSize = 0

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        totalSize += await this.getTotalSize(fullPath)
      } else {
        const stats = await fs.stat(fullPath)
        totalSize += stats.size
      }
    }

    return totalSize
  }
}

// Add crypto import for uuid
import * as crypto from 'crypto'

// Singleton instance
export const buildService = new BuildService()
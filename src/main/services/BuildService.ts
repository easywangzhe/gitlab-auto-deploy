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
  private activeProcesses = new Map<string, Set<ReturnType<typeof execa>>>()

  constructor() {
    this.workspacePath = path.join(app.getPath('userData'), 'workspace')
  }

  /**
   * 以 detached 模式启动子进程（成为进程组 leader），并纳入 projectId 的活跃进程跟踪，
   * 以便取消部署时能通过进程组信号一次性终止整棵进程树（shell -> pnpm -> node -> vue-tsc/vite）。
   */
  private runTracked(
    projectId: string,
    file: string,
    args: string[],
    opts: Parameters<typeof execa>[2] = {}
  ): ReturnType<typeof execa> {
    const child = execa(file, args, { ...opts, detached: true })

    let set = this.activeProcesses.get(projectId)
    if (!set) {
      set = new Set()
      this.activeProcesses.set(projectId, set)
    }
    set.add(child)

    child.on('exit', () => {
      set!.delete(child)
      if (set!.size === 0) {
        this.activeProcesses.delete(projectId)
      }
    })

    return child
  }

  /**
   * 终止某个项目的所有活跃子进程（构建/安装等）。
   * macOS/Linux 用进程组信号杀死整棵树；Windows 用 taskkill /T /F。
   */
  cancelProject(projectId: string): void {
    const set = this.activeProcesses.get(projectId)
    if (!set || set.size === 0) {
      return
    }

    logger.info('build', `Cancelling active build processes for project ${projectId}`, {
      processCount: set.size
    })

    for (const child of Array.from(set)) {
      try {
        if (!child.pid) continue
        if (process.platform === 'win32') {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { execSync } = require('child_process') as typeof import('child_process')
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
        } else {
          // 负 pid 表示向整个进程组发送信号，覆盖 shell 及其所有孙进程
          process.kill(-child.pid, 'SIGTERM')
        }
      } catch (error) {
        logger.warn('build', `Failed to kill build process for project ${projectId}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    this.activeProcesses.delete(projectId)
  }

  private getProjectPath(projectId: string): string {
    return path.join(this.workspacePath, projectId)
  }

  /**
   * 从项目工作目录反推 projectId（workspace 下最后一层目录名）。
   * 用于 install/build 时将子进程归属到对应 projectId，便于取消时定位。
   */
  private getProjectIdFromPath(projectPath: string): string {
    const rel = path.relative(this.workspacePath, projectPath)
    return rel.split(path.sep)[0] || path.basename(projectPath)
  }

  /**
   * 分平台执行 shell 命令并纳入取消追踪。
   * Windows 用 cmd.exe，macOS/Linux 用登录 shell；统一扩展 PATH。
   */
  private runShell(
    projectId: string,
    command: string,
    opts: { cwd: string; timeout: number; all?: boolean }
  ): ReturnType<typeof execa> {
    const isWindows = process.platform === 'win32'
    const file = isWindows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash')
    const args = isWindows ? ['/d', '/s', '/c', command] : ['-l', '-c', command]

    return this.runTracked(projectId, file, args, {
      cwd: opts.cwd,
      timeout: opts.timeout,
      all: opts.all,
      env: {
        ...process.env,
        PATH: this.getEnvPath()
      }
    })
  }

  private async ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Get extended PATH for finding node/npm/pnpm executables
   * Solves the issue where GUI apps don't inherit user's shell PATH
   */
  private getEnvPath(): string {
    const isWindows = process.platform === 'win32'
    const pathSeparator = isWindows ? ';' : ':'
    const home = process.env.HOME || process.env.USERPROFILE || ''

    const possiblePaths: string[] = []

    if (isWindows) {
      // Windows paths
      possiblePaths.push(
        path.join(home, 'AppData', 'Roaming', 'npm'),
        path.join(home, 'AppData', 'Local', 'pnpm'),
        path.join(home, '.nvm', 'nodejs'), // nvm-windows default
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs'
      )

      // Scan nvm-windows for installed versions
      const nvmHome = process.env.NVM_HOME || path.join(home, 'AppData', 'Roaming', 'nvm')
      try {
        const nvmDir = require('fs').readdirSync(nvmHome)
        for (const version of nvmDir) {
          if (/^v?\d+\.\d+\.\d+/.test(version)) {
            possiblePaths.push(path.join(nvmHome, version))
          }
        }
      } catch {
        // nvm directory not found, skip
      }
    } else {
      // macOS / Linux paths
      possiblePaths.push(
        '/usr/local/bin',
        '/opt/homebrew/bin',           // Apple Silicon Homebrew
        '/usr/bin',
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.local', 'bin')
      )

      // Dynamically scan nvm for all installed Node versions
      const nvmDir = path.join(home, '.nvm', 'versions', 'node')
      try {
        const nvmVersions = require('fs').readdirSync(nvmDir)
        for (const version of nvmVersions) {
          possiblePaths.push(path.join(nvmDir, version, 'bin'))
        }
      } catch {
        // nvm directory not found, skip
      }

      // Also check fnm (Fast Node Manager)
      const fnmDir = path.join(home, '.fnm', 'node-versions')
      try {
        const fnmVersions = require('fs').readdirSync(fnmDir)
        for (const version of fnmVersions) {
          possiblePaths.push(path.join(fnmDir, version, 'installation', 'bin'))
        }
      } catch {
        // fnm directory not found, skip
      }
    }

    // Filter out empty paths and deduplicate
    const uniquePaths = [...new Set(possiblePaths.filter(Boolean))]

    logger.info('build', `Extended PATH directories: ${uniquePaths.length} paths`)

    return uniquePaths.join(pathSeparator) + pathSeparator + (process.env.PATH || '')
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

      await this.runTracked(project.id, 'git', ['fetch', 'origin'], { cwd: projectPath })

      if (commitSha) {
        // 回滚模式：checkout 到指定 commit
        logger.info('build', `Checking out commit ${commitSha} for rollback`)
        await this.runTracked(project.id, 'git', ['checkout', commitSha], { cwd: projectPath })
      } else {
        // 正常模式：checkout branch 并 pull
        await this.runTracked(project.id, 'git', ['checkout', branch], { cwd: projectPath })
        await this.runTracked(project.id, 'git', ['pull', 'origin', branch], { cwd: projectPath })
      }
    } catch {
      // Clone fresh
      logger.info('build', `Cloning project ${project.id}`)

      await this.ensureDirectory(this.workspacePath)

      // Construct clone URL using gitlabUrl + gitlabPath
      // Priority: gitlabUrl parameter > project.url
      let cloneUrl: string
      let cleanUrl: string // 不包含 token 的 URL，用于写回 .git/config

      if (gitlabUrl) {
        // Use provided GitLab URL with project path
        const apiUrl = gitlabUrl.replace(/\/+$/, '')
        if (token) {
          const urlObj = new URL(apiUrl)
          cloneUrl = `${urlObj.protocol}//oauth2:${token}@${urlObj.host}/${project.gitlabPath}.git`
          cleanUrl = `${apiUrl}/${project.gitlabPath}.git`
        } else {
          cloneUrl = `${apiUrl}/${project.gitlabPath}.git`
          cleanUrl = cloneUrl
        }
      } else if (project.url) {
        // Fallback to project.url if available
        const parsedUrl = new URL(project.url)
        if (token) {
          cloneUrl = `https://oauth2:${token}@${parsedUrl.host}${parsedUrl.pathname}.git`
          cleanUrl = `${project.url}.git`
        } else {
          cloneUrl = `${project.url}.git`
          cleanUrl = cloneUrl
        }
      } else {
        throw new Error('GitLab URL is required. Please configure GitLab connection in settings.')
      }

      logger.info('build', `Cloning from ${cloneUrl.replace(/oauth2:[^@]+@/, 'oauth2:***@')}`)

      await this.runTracked(project.id, 'git', ['clone', '-b', branch, cloneUrl, projectPath])

      // 克隆后立即清除 .git/config 中带 token 的 remote URL，避免 token 泄漏到工作区
      if (cleanUrl !== cloneUrl) {
        try {
          await execa('git', ['remote', 'set-url', 'origin', cleanUrl], { cwd: projectPath })
          logger.info('build', `Sanitized origin remote URL for ${project.id}`)
        } catch (err) {
          logger.warn('build', `Failed to sanitize origin remote URL for ${project.id}`, {
            error: err instanceof Error ? err.message : 'Unknown error'
          })
        }
      }

      if (commitSha) {
        // 克隆后 checkout 到指定 commit
        logger.info('build', `Checking out commit ${commitSha} after clone`)
        await this.runTracked(project.id, 'git', ['checkout', commitSha], { cwd: projectPath })
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

  /**
   * 依赖是否变化：用 package.json + 锁文件内容哈希判断；
   * 未变化且 node_modules 存在时返回 false（可跳过安装）。
   */
  async dependenciesChanged(projectPath: string): Promise<boolean> {
    const hashFile = path.join(projectPath, '.deps-hash.json')
    const lockFiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'package.json']

    const hash = crypto.createHash('sha256')
    for (const f of lockFiles) {
      const p = path.join(projectPath, f)
      try {
        hash.update(await fs.readFile(p))
      } catch {
        // 文件不存在则跳过
      }
    }
    const current = hash.digest('hex')

    let previous = ''
    try {
      previous = JSON.parse(await fs.readFile(hashFile, 'utf-8')).hash || ''
    } catch {
      // 无缓存
    }

    const nodeModulesExists = await fs.access(path.join(projectPath, 'node_modules')).then(() => true).catch(() => false)

    // 记录本次哈希
    await fs.writeFile(hashFile, JSON.stringify({ hash: current }))

    if (previous && previous === current && nodeModulesExists) {
      logger.info('build', 'Dependencies unchanged, skipping install')
      return false
    }
    return true
  }

  async installDependencies(
    projectPath: string,
    packageManager: PackageManager
  ): Promise<void> {
    logger.info('build', `Installing dependencies with ${packageManager}`)

    const commands: Record<PackageManager, string> = {
      npm: 'npm install --ignore-scripts',
      yarn: 'yarn install --ignore-scripts',
      pnpm: 'pnpm install --ignore-scripts'
    }

    const command = commands[packageManager]

    await this.runShell(this.getProjectIdFromPath(projectPath), command, {
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
    timeout: number = 600000,
    customBuildCommand?: string, // 自定义构建命令，如 "npm run build:prod"
    packageManager: PackageManager = 'npm'
  ): Promise<BuildJob> {
    const jobId = crypto.randomUUID()
    const startTime = new Date()

    logger.info('build', `Starting build job ${jobId}`, { command, customBuildCommand, packageManager, timeout })

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
      // 如果有自定义构建命令，直接使用；否则用检测到的包管理器执行对应的 build 脚本
      const buildCommand = customBuildCommand || `${packageManager} run ${command}`

      const result = await this.runShell(this.getProjectIdFromPath(projectPath), buildCommand, {
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
/**
 * GitLab Auto Deploy Tool - Core Type Definitions
 * Based on Deep Interview Spec with 21 entities
 */

import { z } from 'zod'

// ============================================================================
// Enums
// ============================================================================

/** 包管理器类型 */
export const PackageManagerEnum = z.enum(['npm', 'yarn', 'pnpm'])
export type PackageManager = z.infer<typeof PackageManagerEnum>

/** 部署状态 */
export const DeploymentStatusEnum = z.enum([
  'pending',      // 排队中
  'cloning',      // 克隆代码中
  'installing',   // 安装依赖中
  'building',     // 打包构建中
  'uploading',    // 上传中
  'health_check', // 健康检查中
  'success',      // 成功
  'failed',       // 失败
  'cancelled',    // 已取消
  'rollback'      // 回滚中
])
export type DeploymentStatus = z.infer<typeof DeploymentStatusEnum>

/** MR 状态 */
export const MergeRequestStateEnum = z.enum(['opened', 'closed', 'merged', 'locked'])
export type MergeRequestState = z.infer<typeof MergeRequestStateEnum>

/** 构建任务状态 */
export const BuildJobStatusEnum = z.enum(['pending', 'running', 'success', 'failed', 'timeout', 'cancelled'])
export type BuildJobStatus = z.infer<typeof BuildJobStatusEnum>

/** 回滚状态 */
export const RollbackStatusEnum = z.enum(['pending', 'running', 'success', 'failed'])
export type RollbackStatus = z.infer<typeof RollbackStatusEnum>

/** 健康检查类型 */
export const HealthCheckTypeEnum = z.enum(['basic', 'advanced', 'custom'])
export type HealthCheckType = z.infer<typeof HealthCheckTypeEnum>

/** 通知类型 */
export const NotificationTypeEnum = z.enum(['info', 'success', 'warning', 'error'])
export type NotificationType = z.infer<typeof NotificationTypeEnum>

/** 用户角色 */
export const UserRoleEnum = z.enum(['admin', 'user', 'viewer'])
export type UserRole = z.infer<typeof UserRoleEnum>

// ============================================================================
// Value Objects
// ============================================================================

/** GitLab API Token */
export const GitLabAPITokenSchema = z.object({
  value: z.string().min(1),
  createdAt: z.date(),
  expiresAt: z.date().optional()
})
export interface GitLabAPIToken extends z.infer<typeof GitLabAPITokenSchema> {}

/** SSH 认证类型 */
export const SSHAuthTypeEnum = z.enum(['privateKey', 'password'])
export type SSHAuthType = z.infer<typeof SSHAuthTypeEnum>

/** SSH 凭据 */
export const SSHCredentialsSchema = z.object({
  id: z.string().uuid(),
  authType: SSHAuthTypeEnum.default('privateKey'),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  password: z.string().optional()
})
export interface SSHCredentials extends z.infer<typeof SSHCredentialsSchema> {}

/** Lock 文件 */
export const LockFileSchema = z.object({
  name: z.string(),
  packageManager: PackageManagerEnum,
  path: z.string()
})
export interface LockFile extends z.infer<typeof LockFileSchema> {}

/** 部署配置 */
export const DeploymentConfigSchema = z.object({
  projectId: z.string().uuid(),
  targetBranch: z.string().min(1),
  deployPath: z.string().min(1), // 部署目标路径
  buildCommandOverride: z.string().optional(),
  healthCheckUrl: z.string().url().optional(),
  healthCheckType: HealthCheckTypeEnum.default('basic'),
  healthCheckExpectedStatus: z.number().int().min(100).max(599).default(200),
  healthCheckTimeout: z.number().int().positive().default(60000), // 60秒
  healthCheckRetryCount: z.number().int().nonnegative().default(3),
  healthCheckRetryInterval: z.number().int().positive().default(10000), // 10秒
  buildTimeout: z.number().int().positive().default(600000), // 10分钟
  uploadTimeout: z.number().int().positive().default(300000) // 5分钟
})
export interface DeploymentConfig extends z.infer<typeof DeploymentConfigSchema> {}

// ============================================================================
// Core Domain Entities
// ============================================================================

/** 分支 */
export const BranchSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().uuid(),
  isTarget: z.boolean().default(false)
})
export interface Branch extends z.infer<typeof BranchSchema> {}

/** GitLab 项目 - 支持多 GitLab、多服务器 */
export const GitLabProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  gitlabId: z.number().int().positive().optional(),
  gitlabPath: z.string().min(1), // GitLab 项目路径，如 group/project
  gitlabConnectionId: z.string().uuid(), // 关联的 GitLab 连接 ID
  serverId: z.string().uuid(), // 关联的服务器 ID
  url: z.string().url().optional(),
  branch: z.string().min(1).default('main'), // 监听的分支
  targetBranch: z.string().min(1).default('main'), // 部署目标分支
  deployPath: z.string().min(1), // 服务器部署路径
  healthCheckUrl: z.string().url().optional().or(z.literal('')), // 健康检查 URL
  outputDir: z.string().default('dist'),
  buildCommand: z.string().optional(), // 自定义构建命令，如 "npm run build:prod"
  packageManager: PackageManagerEnum.optional(),
  autoDeploy: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date()
})
export interface GitLabProject extends z.infer<typeof GitLabProjectSchema> {}

/** 合并请求 */
export const MergeRequestSchema = z.object({
  id: z.string().uuid(),
  gitlabId: z.number().int().positive(),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  state: MergeRequestStateEnum,
  mergedAt: z.date().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  projectId: z.string().uuid(),
  sha: z.string().optional()
})
export interface MergeRequest extends z.infer<typeof MergeRequestSchema> {}

/** 构建任务 */
export const BuildJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  mergeRequestId: z.string().uuid(),
  status: BuildJobStatusEnum,
  startTime: z.date(),
  endTime: z.date().optional(),
  exitCode: z.number().int().optional(),
  outputPath: z.string().optional(),
  outputSize: z.number().int().nonnegative().optional(),
  fileCount: z.number().int().nonnegative().optional(),
  timeout: z.number().int().positive().default(600000),
  logs: z.array(z.string()).default([])
})
export interface BuildJob extends z.infer<typeof BuildJobSchema> {}

/** 部署产物 */
export const DeploymentArtifactSchema = z.object({
  id: z.string().uuid(),
  buildJobId: z.string().uuid(),
  path: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalSize: z.number().int().nonnegative(),
  createdAt: z.date()
})
export interface DeploymentArtifact extends z.infer<typeof DeploymentArtifactSchema> {}

/** 服务器 - 单实例配置，包含认证信息 */
export const ServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  authType: SSHAuthTypeEnum.default('privateKey'),
  sshCredentialId: z.string().uuid().optional(),
  password: z.string().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional()
})
export interface Server extends z.infer<typeof ServerSchema> {}

/** 备份 */
export const BackupSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string().uuid().optional(),
  serverId: z.string().uuid(),
  path: z.string(),
  version: z.string(),
  createdAt: z.date(),
  size: z.number().int().nonnegative().optional()
})
export interface Backup extends z.infer<typeof BackupSchema> {}

/** 部署 */
export const DeploymentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  artifactId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  mergeRequestId: z.string().uuid(),
  status: DeploymentStatusEnum,
  progress: z.number().min(0).max(100).default(0),
  startedAt: z.date(),
  completedAt: z.date().optional(),
  backupId: z.string().uuid().optional(),
  logs: z.array(z.object({
    timestamp: z.date(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string()
  })).default([]),
  error: z.string().optional(),
  commitSha: z.string().optional(),        // 部署的 commit SHA
  isRollback: z.boolean().default(false),  // 是否为回滚部署
  rollbackFromSha: z.string().optional()   // 回滚前的 SHA
})
export interface Deployment extends z.infer<typeof DeploymentSchema> {}

/** Commit 信息（用于回滚选择） */
export const CommitInfoSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),      // 前 7 位
  message: z.string(),
  author: z.string(),
  authoredAt: z.date()
})
export type CommitInfo = z.infer<typeof CommitInfoSchema>

/** 回滚 */
export const RollbackSchema = z.object({
  id: z.string().uuid(),
  deploymentId: z.string().uuid(),
  backupId: z.string().uuid(),
  triggeredBy: z.string().uuid(), // userId
  status: RollbackStatusEnum,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  error: z.string().optional()
})
export interface Rollback extends z.infer<typeof RollbackSchema> {}

// ============================================================================
// Supporting Entities
// ============================================================================

/** 用户 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  role: UserRoleEnum.default('user'),
  createdAt: z.date()
})
export interface User extends z.infer<typeof UserSchema> {}

/** 通知 */
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  deploymentId: z.string().uuid().optional(),
  type: NotificationTypeEnum,
  message: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  createdAt: z.date(),
  read: z.boolean().default(false)
})
export interface Notification extends z.infer<typeof NotificationSchema> {}

// ============================================================================
// Service Types
// ============================================================================

/** GitLab 连接配置 */
export const GitLabConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  apiUrl: z.string().url(),
  token: z.string().min(1)
})
export interface GitLabConnection extends z.infer<typeof GitLabConnectionSchema> {}

/** 健康检查配置 */
export const HealthCheckSchema = z.object({
  url: z.string().url(),
  expectedStatusCode: z.number().int().min(100).max(599).default(200),
  timeout: z.number().int().positive().default(60000),
  retryCount: z.number().int().nonnegative().default(3),
  retryInterval: z.number().int().positive().default(10000)
})
export interface HealthCheck extends z.infer<typeof HealthCheckSchema> {}

/** 部署队列 */
export const DeploymentQueueSchema = z.object({
  maxConcurrent: z.number().int().positive().default(1), // 串行部署
  currentQueue: z.array(z.string().uuid()).default([])
})
export interface DeploymentQueue extends z.infer<typeof DeploymentQueueSchema> {}

/** 凭据存储配置 */
export const CredentialStorageSchema = z.object({
  encryptionMethod: z.enum(['aes-256-gcm']).default('aes-256-gcm'),
  storageLocation: z.string()
})
export interface CredentialStorage extends z.infer<typeof CredentialStorageSchema> {}

/** Webhook 配置 */
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.enum([
    'deployment.started',
    'deployment.success',
    'deployment.failed',
    'deployment.cancelled',
    'deployment.rollback'
  ])),
  enabled: z.boolean().default(true)
})
export interface WebhookConfig extends z.infer<typeof WebhookConfigSchema> {}

/** Prometheus 指标配置 */
export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(9090),
  path: z.string().default('/metrics')
})
export interface MetricsConfig extends z.infer<typeof MetricsConfigSchema> {}

/** 应用设置 - 多 GitLab 连接、多服务器配置模式 */
export const AppSettingsSchema = z.object({
  gitlabConnections: z.array(GitLabConnectionSchema).default([]),
  servers: z.array(ServerSchema).default([]),
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  notifications: z.object({
    enabled: z.boolean().default(true),
    notifyOnSuccess: z.boolean().default(true),
    notifyOnFailure: z.boolean().default(true)
  }),
  daemon: z.object({
    enabled: z.boolean().default(false),
    pollingInterval: z.number().int().positive().default(60000),
    scheduleEnabled: z.boolean().default(false),
    startTime: z.string().default('09:00'),      // 开始时间 HH:mm
    endTime: z.string().default('18:00')         // 结束时间 HH:mm
  })
})
export interface AppSettings extends z.infer<typeof AppSettingsSchema> {}

// ============================================================================
// Aggregate Root
// ============================================================================

/** 应用配置 */
export const ApplicationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().default('GitLab Auto Deploy'),
  version: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  settings: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    logRetentionDays: z.number().int().positive().default(30),
    enableNotifications: z.boolean().default(true),
    backupRetention: z.number().int().positive().default(3), // 保留3个备份
    daemonMode: z.boolean().default(false),
    pollingInterval: z.number().int().positive().default(60000)
  }),
  credentialStorage: CredentialStorageSchema,
  createdAt: z.date(),
  updatedAt: z.date()
})
export interface Application extends z.infer<typeof ApplicationSchema> {}

// ============================================================================
// IPC Types
// ============================================================================

/** IPC 通道名称 */
export const IpcChannel = {
  // 项目管理
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',

  // 服务器管理
  SERVER_CREATE: 'server:create',
  SERVER_UPDATE: 'server:update',
  SERVER_DELETE: 'server:delete',
  SERVER_LIST: 'server:list',

  // 部署操作
  DEPLOY_START: 'deploy:start',
  DEPLOY_CANCEL: 'deploy:cancel',
  DEPLOY_STATUS: 'deploy:status',
  DEPLOY_LIST: 'deploy:list',
  DEPLOY_LOGS: 'deploy:logs',

  // 回滚
  ROLLBACK_TRIGGER: 'rollback:trigger',
  ROLLBACK_STATUS: 'rollback:status',

  // 备份
  BACKUP_LIST: 'backup:list',

  // 凭据
  CREDENTIALS_STORE: 'credentials:store',
  CREDENTIALS_GET: 'credentials:get',
  CREDENTIALS_TEST: 'credentials:test',

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // 通知
  NOTIFICATION_LIST: 'notification:list',
  NOTIFICATION_READ: 'notification:read',

  // GitLab
  GITLAB_TEST: 'gitlab:test',
  GITLAB_MR_LIST: 'gitlab:mr-list',

  // Daemon
  DAEMON_START: 'daemon:start',
  DAEMON_STOP: 'daemon:stop',
  DAEMON_STATUS: 'daemon:status'
} as const

/** IPC 请求类型映射 */
export interface IpcRequestMap {
  [IpcChannel.PROJECT_CREATE]: { data: Omit<GitLabProject, 'id' | 'createdAt' | 'updatedAt'> }
  [IpcChannel.PROJECT_UPDATE]: { id: string; data: Partial<GitLabProject> }
  [IpcChannel.PROJECT_DELETE]: { id: string }
  [IpcChannel.PROJECT_LIST]: void
  [IpcChannel.PROJECT_GET]: { id: string }

  [IpcChannel.SERVER_CREATE]: { data: Omit<Server, 'id' | 'createdAt' | 'updatedAt'> }
  [IpcChannel.SERVER_UPDATE]: { id: string; data: Partial<Server> }
  [IpcChannel.SERVER_DELETE]: { id: string }
  [IpcChannel.SERVER_LIST]: void

  [IpcChannel.DEPLOY_START]: { projectId: string; mergeRequestId?: string }
  [IpcChannel.DEPLOY_CANCEL]: { deploymentId: string }
  [IpcChannel.DEPLOY_STATUS]: { deploymentId: string }
  [IpcChannel.DEPLOY_LIST]: { projectId?: string }
  [IpcChannel.DEPLOY_LOGS]: { deploymentId: string }

  [IpcChannel.ROLLBACK_TRIGGER]: { deploymentId: string; backupId: string }
  [IpcChannel.ROLLBACK_STATUS]: { rollbackId: string }

  [IpcChannel.BACKUP_LIST]: { serverId: string }

  [IpcChannel.CREDENTIALS_STORE]: { type: 'gitlab' | 'ssh'; data: unknown }
  [IpcChannel.CREDENTIALS_GET]: { type: 'gitlab' | 'ssh' }
  [IpcChannel.CREDENTIALS_TEST]: { type: 'gitlab' | 'ssh'; data: unknown }

  [IpcChannel.SETTINGS_GET]: void
  [IpcChannel.SETTINGS_UPDATE]: { data: Partial<Application['settings']> }

  [IpcChannel.NOTIFICATION_LIST]: { userId: string }
  [IpcChannel.NOTIFICATION_READ]: { notificationId: string }

  [IpcChannel.GITLAB_TEST]: { apiUrl: string; token: string }
  [IpcChannel.GITLAB_MR_LIST]: { projectId: string }

  [IpcChannel.DAEMON_START]: void
  [IpcChannel.DAEMON_STOP]: void
  [IpcChannel.DAEMON_STATUS]: void
}

/** IPC 响应类型 */
export interface IpcResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

// ============================================================================
// API Types
// ============================================================================

/** GitLab MR API 响应 */
export const GitLabMRResponseSchema = z.object({
  id: z.number(),
  iid: z.number(),
  project_id: z.number(),
  title: z.string(),
  description: z.string().optional(),
  state: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  merged_at: z.string().optional(),
  merge_commit_sha: z.string().optional(),
  author: z.object({
    id: z.number(),
    username: z.string(),
    name: z.string()
  }),
  web_url: z.string()
})
export type GitLabMRResponse = z.infer<typeof GitLabMRResponseSchema>

/** GitLab Project API 响应 */
export const GitLabProjectResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  path_with_namespace: z.string(),
  web_url: z.string(),
  ssh_url_to_repo: z.string().optional(),
  http_url_to_repo: z.string().optional()
})
export type GitLabProjectResponse = z.infer<typeof GitLabProjectResponseSchema>

// ============================================================================
// Log Types
// ============================================================================

export interface LogEntry {
  timestamp: Date
  level: 'debug' | 'info' | 'warn' | 'error'
  category: string
  message: string
  data?: Record<string, unknown>
}

// ============================================================================
// Exports
// ============================================================================

export const EntitySchemas = {
  GitLabProject: GitLabProjectSchema,
  Branch: BranchSchema,
  MergeRequest: MergeRequestSchema,
  BuildJob: BuildJobSchema,
  DeploymentArtifact: DeploymentArtifactSchema,
  Server: ServerSchema,
  DeploymentConfig: DeploymentConfigSchema,
  Deployment: DeploymentSchema,
  User: UserSchema,
  Notification: NotificationSchema,
  Application: ApplicationSchema,
  GitLabConnection: GitLabConnectionSchema,
  SSHCredentials: SSHCredentialsSchema,
  HealthCheck: HealthCheckSchema,
  PackageManager: PackageManagerEnum,
  LockFile: LockFileSchema,
  Backup: BackupSchema,
  Rollback: RollbackSchema,
  GitLabAPIToken: GitLabAPITokenSchema,
  DeploymentQueue: DeploymentQueueSchema,
  CredentialStorage: CredentialStorageSchema
}

/** 所有实体的类型映射 */
export type EntityTypeMap = {
  GitLabProject: GitLabProject
  Branch: Branch
  MergeRequest: MergeRequest
  BuildJob: BuildJob
  DeploymentArtifact: DeploymentArtifact
  Server: Server
  DeploymentConfig: DeploymentConfig
  Deployment: Deployment
  User: User
  Notification: Notification
  Application: Application
  GitLabConnection: GitLabConnection
  SSHCredentials: SSHCredentials
  HealthCheck: HealthCheck
  PackageManager: PackageManager
  LockFile: LockFile
  Backup: Backup
  Rollback: Rollback
  GitLabAPIToken: GitLabAPIToken
  DeploymentQueue: DeploymentQueue
  CredentialStorage: CredentialStorage
}
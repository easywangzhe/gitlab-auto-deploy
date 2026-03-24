<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useProjectsStore } from '../stores/projects'
import { useDeploymentsStore } from '../stores/deployments'
import { useSettingsStore } from '../stores/settings'
import type { GitLabProject, Deployment, DeploymentStatus, CommitInfo } from '../../../shared/types'

const route = useRoute()
const router = useRouter()
const projectsStore = useProjectsStore()
const deploymentsStore = useDeploymentsStore()
const settingsStore = useSettingsStore()

const loading = ref(false)
const deploying = ref(false)
const projectId = computed(() => route.params.id as string)
const project = computed(() => projectsStore.getProjectById(projectId.value))
const projectDeployments = computed(() => {
  const deployments = deploymentsStore.getDeploymentsByProject(projectId.value)
  return [...deployments].sort((a, b) => {
    const timeA = new Date(a.startedAt).getTime()
    const timeB = new Date(b.startedAt).getTime()
    return timeB - timeA
  })
})

// 回滚相关状态
const rollbackDialogVisible = ref(false)
const commits = ref<CommitInfo[]>([])
const loadingCommits = ref(false)
const selectedCommit = ref<CommitInfo | null>(null)
const rollingBack = ref(false)

const statusColors: Record<string, string> = {
  pending: 'warning',
  cloning: 'primary',
  installing: 'primary',
  building: 'primary',
  uploading: 'primary',
  health_check: 'primary',
  success: 'success',
  failed: 'danger',
  cancelled: 'info',
  rollback: 'warning'
}

const statusLabels: Record<string, string> = {
  pending: '等待中',
  cloning: '克隆代码',
  installing: '安装依赖',
  building: '构建中',
  uploading: '上传中',
  health_check: '健康检查',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  rollback: '回滚中'
}

onMounted(async () => {
  loading.value = true
  try {
    await projectsStore.loadProjects()
    await deploymentsStore.loadDeployments()
    await settingsStore.loadSettings()
  } finally {
    loading.value = false
  }
})

const startDeploy = async () => {
  if (!project.value || deploying.value) return

  // Check if server exists for this project
  const server = settingsStore.getServerById(project.value.serverId)
  if (!server) {
    ElMessage.warning('项目关联的服务器不存在，请重新编辑项目')
    return
  }

  deploying.value = true
  try {
    await deploymentsStore.startDeployment(project.value.id, '')
    ElMessage.success('部署已启动')
  } catch (error) {
    ElMessage.error('启动部署失败: ' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    // 防抖：延迟重置状态
    setTimeout(() => {
      deploying.value = false
    }, 1000)
  }
}

const formatDate = (date: Date) => {
  return new Date(date).toLocaleString('zh-CN')
}

const formatDuration = (start: Date, end?: Date) => {
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : Date.now()
  const seconds = Math.floor((endTime - startTime) / 1000)
  
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`
}

const goBack = () => {
  router.push('/projects')
}

// 打开回滚对话框
const openRollbackDialog = async () => {
  if (!project.value) return

  // 检查 GitLab ID 是否配置
  if (!project.value.gitlabId) {
    ElMessage.warning('项目未关联 GitLab 项目 ID，请重新编辑项目并选择 GitLab 项目')
    return
  }

  // 检查 GitLab 连接是否存在
  const connection = settingsStore.getGitLabConnectionById(project.value.gitlabConnectionId)
  if (!connection) {
    ElMessage.warning('项目关联的 GitLab 连接不存在，请重新编辑项目')
    return
  }

  rollbackDialogVisible.value = true
  loadingCommits.value = true
  selectedCommit.value = null

  try {
    commits.value = await deploymentsStore.getBranchCommits(
      project.value.gitlabId.toString(),
      project.value.branch,
      20,
      project.value.gitlabConnectionId
    )
    if (commits.value.length === 0) {
      ElMessage.warning('未找到提交记录')
    }
  } catch (error) {
    ElMessage.error('获取提交记录失败: ' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    loadingCommits.value = false
  }
}

// 选择 commit
const handleCommitSelect = (commit: CommitInfo) => {
  selectedCommit.value = commit
}

// 执行回滚
const executeRollback = async () => {
  if (!selectedCommit.value || !project.value) return

  rollingBack.value = true
  try {
    await deploymentsStore.rollbackToCommit(
      projectId.value,
      selectedCommit.value.sha,
      project.value.branch
    )
    ElMessage.success('回滚部署已开始')
    rollbackDialogVisible.value = false
  } catch (error) {
    ElMessage.error('回滚失败: ' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    rollingBack.value = false
  }
}

// 格式化时间
const formatTime = (date: Date) => {
  return new Date(date).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="project-detail-view" v-loading="loading">
    <el-page-header @back="goBack">
      <template #content>
        <span class="project-title">{{ project?.name || '加载中...' }}</span>
      </template>
      <template #title>
        <span>返回</span>
      </template>
    </el-page-header>

    <el-divider />

    <template v-if="project">
      <!-- 项目信息 -->
      <el-card class="info-card">
        <template #header>
          <div class="card-header">
            <span>项目信息</span>
            <div class="card-header-actions">
              <el-button type="warning" @click="openRollbackDialog">回滚</el-button>
              <el-button type="primary" @click="startDeploy" :loading="deploying" :disabled="deploying">开始部署</el-button>
            </div>
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="项目名称">{{ project.name }}</el-descriptions-item>
          <el-descriptions-item label="GitLab 路径">{{ project.gitlabPath }}</el-descriptions-item>
          <el-descriptions-item label="GitLab">
            <el-tag size="small">{{ settingsStore.getGitLabConnectionById(project.gitlabConnectionId)?.name || '未知' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="服务器">
            <el-tag size="small" type="info">{{ settingsStore.getServerById(project.serverId)?.name || '未知' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="监听分支">{{ project.branch }}</el-descriptions-item>
          <el-descriptions-item label="部署路径">{{ project.deployPath }}</el-descriptions-item>
          <el-descriptions-item label="输出目录">{{ project.outputDir }}</el-descriptions-item>
          <el-descriptions-item label="构建命令">{{ project.buildCommand || '自动检测' }}</el-descriptions-item>
          <el-descriptions-item label="自动部署">
            <el-tag :type="project.autoDeploy ? 'success' : 'info'" size="small">
              {{ project.autoDeploy ? '已启用' : '未启用' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="健康检查URL">{{ project.healthCheckUrl || '未配置' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDate(project.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDate(project.updatedAt) }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 部署历史 -->
      <el-card class="deployments-card">
        <template #header>
          <span>部署历史</span>
        </template>

        <el-table :data="projectDeployments" stripe v-if="projectDeployments.length > 0">
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <div class="status-cell">
                <el-tag :type="statusColors[row.status]" size="small">
                  {{ statusLabels[row.status] }}
                </el-tag>
                <el-tag v-if="row.isRollback" type="warning" size="small" style="margin-left: 4px">回滚</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="Commit" width="90">
            <template #default="{ row }">
              <el-tooltip v-if="row.commitSha" :content="row.commitSha" placement="top">
                <span class="commit-sha">{{ row.commitSha.substring(0, 7) }}</span>
              </el-tooltip>
              <span v-else class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="进度" width="140">
            <template #default="{ row }">
              <el-progress
                :percentage="row.progress || 0"
                :status="row.status === 'success' ? 'success' : row.status === 'failed' ? 'exception' : undefined"
                :stroke-width="6"
              />
            </template>
          </el-table-column>
          <el-table-column label="开始时间" width="170">
            <template #default="{ row }">
              {{ formatDate(row.startedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="100">
            <template #default="{ row }">
              {{ formatDuration(row.startedAt, row.completedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="错误信息" min-width="200">
            <template #default="{ row }">
              <el-tooltip v-if="row.error" :content="row.error" placement="top">
                <span class="error-text">{{ row.error }}</span>
              </el-tooltip>
              <span v-else class="text-muted">-</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无部署记录" :image-size="80" />
      </el-card>
    </template>

    <el-empty v-else description="项目不存在" />

    <!-- 回滚对话框 -->
    <el-dialog v-model="rollbackDialogVisible" title="选择回滚版本" width="700px">
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
        <template #title>
          <strong>注意</strong>：回滚将重新部署所选版本的代码，请确认数据兼容性。
        </template>
      </el-alert>

      <el-form label-width="80px">
        <el-form-item label="当前分支">
          <el-tag>{{ project?.branch }}</el-tag>
        </el-form-item>
        <el-form-item label="选择版本">
          <el-table :data="commits" v-loading="loadingCommits" max-height="400" highlight-current-row @current-change="handleCommitSelect">
            <el-table-column prop="shortSha" label="Commit" width="100" />
            <el-table-column prop="message" label="提交信息" />
            <el-table-column prop="author" label="作者" width="100" />
            <el-table-column prop="authoredAt" label="时间" width="160">
              <template #default="{ row }">
                {{ formatTime(row.authoredAt) }}
              </template>
            </el-table-column>
          </el-table>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="rollbackDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedCommit" @click="executeRollback" :loading="rollingBack">
          确认回滚
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.project-detail-view {
  .project-title {
    font-size: 18px;
    font-weight: 600;
  }

  .info-card,
  .deployments-card {
    margin-top: 20px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .card-header-actions {
    display: flex;
    gap: 8px;
  }

  .status-cell {
    display: flex;
    align-items: center;
  }

  .commit-sha {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 12px;
    color: #409eff;
    background: #ecf5ff;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }

  .text-muted {
    color: #909399;
  }

  .error-text {
    color: #f56c6c;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    max-width: 200px;
  }
}
</style>

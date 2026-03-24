<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useDeploymentsStore } from '../stores/deployments'
import { useProjectsStore } from '../stores/projects'
import type { Deployment } from '../../../shared/types'

const deploymentsStore = useDeploymentsStore()
const projectsStore = useProjectsStore()

const loading = ref(false)
const activeTab = ref('all')
const logDialogVisible = ref(false)
const selectedDeployment = ref<Deployment | null>(null)
const deploymentLogs = ref<Array<{ timestamp: Date; level: string; message: string }>>([])
const loadingLogs = ref(false)

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

// Sort by startedAt descending (newest first)
const sortByDateDesc = (deployments: Deployment[]) => {
  return [...deployments].sort((a, b) => {
    const timeA = new Date(a.startedAt).getTime()
    const timeB = new Date(b.startedAt).getTime()
    return timeB - timeA
  })
}

const allDeployments = computed(() => sortByDateDesc(deploymentsStore.deployments))
const runningDeployments = computed(() =>
  allDeployments.value.filter(d =>
    d.status !== 'success' &&
    d.status !== 'failed' &&
    d.status !== 'cancelled'
  )
)
const completedDeployments = computed(() =>
  allDeployments.value.filter(d => d.status === 'success' || d.status === 'failed' || d.status === 'cancelled')
)

const currentTabDeployments = computed(() => {
  switch (activeTab.value) {
    case 'running': return runningDeployments.value
    case 'completed': return completedDeployments.value
    default: return allDeployments.value
  }
})

onMounted(async () => {
  loading.value = true
  try {
    await deploymentsStore.loadDeployments()
    await projectsStore.loadProjects()
  } finally {
    loading.value = false
  }
})

const getProjectName = (projectId: string) => {
  const project = projectsStore.getProjectById(projectId)
  return project?.name || projectId
}

const formatDate = (date: Date) => {
  return new Date(date).toLocaleString('zh-CN')
}

const cancelDeployment = async (deploymentId: string) => {
  try {
    await deploymentsStore.cancelDeployment(deploymentId)
    ElMessage.success('部署已取消')
  } catch (error) {
    ElMessage.error('取消失败')
  }
}

const handleDelete = async (deploymentId: string) => {
  try {
    const success = await deploymentsStore.deleteDeployment(deploymentId)
    if (success) {
      ElMessage.success('部署记录已删除')
    } else {
      ElMessage.error('删除失败')
    }
  } catch (error) {
    ElMessage.error('删除失败')
  }
}

const viewLogs = async (deployment: Deployment) => {
  selectedDeployment.value = deployment
  logDialogVisible.value = true
  loadingLogs.value = true
  deploymentLogs.value = []

  try {
    const logs = await deploymentsStore.getDeploymentLogs(deployment.id)
    deploymentLogs.value = logs
  } catch (error) {
    ElMessage.error('加载日志失败')
  } finally {
    loadingLogs.value = false
  }
}

const openWorkspace = async (projectId: string) => {
  const result = await window.electronAPI.openWorkspace(projectId)
  if (!result.success) {
    ElMessage.error(result.error || '打开目录失败')
  }
}

const formatLogTime = (timestamp: Date) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const getLogLevelType = (level: string): string => {
  switch (level) {
    case 'error': return 'danger'
    case 'warn': return 'warning'
    case 'info': return 'primary'
    case 'debug': return 'info'
    default: return 'info'
  }
}
</script>

<template>
  <div class="deployments-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>部署队列</span>
          <div class="stats">
            <el-tag type="primary">运行中: {{ runningDeployments.length }}</el-tag>
            <el-tag type="info">已完成: {{ completedDeployments.length }}</el-tag>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="全部" name="all" />
        <el-tab-pane label="运行中" name="running" />
        <el-tab-pane label="已完成" name="completed" />
      </el-tabs>

      <el-table :data="currentTabDeployments" v-loading="loading" stripe>
        <el-table-column label="项目" min-width="150">
          <template #default="{ row }">
            {{ getProjectName(row.projectId) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusColors[row.status]">
              {{ statusLabels[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            <el-progress 
              :percentage="row.progress || 0"
              :status="row.status === 'success' ? 'success' : row.status === 'failed' ? 'exception' : undefined"
            />
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.startedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="消息" min-width="200">
          <template #default="{ row }">
            <el-tooltip
              :content="row.logs?.slice(-1)[0]?.message || '-'"
              placement="top"
              :disabled="!row.logs?.slice(-1)[0]?.message || row.logs?.slice(-1)[0]?.message.length < 50"
            >
              <div class="message-cell">
                {{ row.logs?.slice(-1)[0]?.message || '-' }}
              </div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="viewLogs(row)">日志</el-button>
            <el-button size="small" link type="primary" @click="openWorkspace(row.projectId)">目录</el-button>
            <el-button
              v-if="row.status === 'pending' || row.status === 'cloning' || row.status === 'installing' || row.status === 'building' || row.status === 'uploading' || row.status === 'health_check'"
              size="small"
              link
              type="danger"
              @click="cancelDeployment(row.id)"
            >
              取消
            </el-button>
            <el-button
              v-if="row.status === 'success' || row.status === 'failed' || row.status === 'cancelled'"
              size="small"
              link
              type="danger"
              @click="handleDelete(row.id)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 日志查看对话框 -->
    <el-dialog
      v-model="logDialogVisible"
      :title="`部署日志 - ${selectedDeployment?.id?.slice(0, 8) || ''}`"
      width="800px"
      destroy-on-close
    >
      <div class="log-container" v-loading="loadingLogs">
        <div v-if="deploymentLogs.length === 0 && !loadingLogs" class="no-logs">
          暂无日志
        </div>
        <div v-else class="log-list">
          <div
            v-for="(log, index) in deploymentLogs"
            :key="index"
            class="log-item"
          >
            <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
            <el-tag :type="getLogLevelType(log.level)" size="small" class="log-level">
              {{ log.level.toUpperCase() }}
            </el-tag>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="logDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.deployments-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .stats {
      display: flex;
      gap: 10px;
    }
  }

  .message-cell {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-container {
    max-height: 500px;
    overflow-y: auto;
    background: #1e1e1e;
    border-radius: 4px;
    padding: 16px;

    .no-logs {
      color: #888;
      text-align: center;
      padding: 40px;
    }

    .log-list {
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.8;

      .log-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 4px 0;
        border-bottom: 1px solid #333;

        &:last-child {
          border-bottom: none;
        }

        .log-time {
          color: #888;
          flex-shrink: 0;
          min-width: 160px;
        }

        .log-level {
          flex-shrink: 0;
          min-width: 50px;
        }

        .log-message {
          color: #e0e0e0;
          word-break: break-all;
        }
      }
    }
  }
}
</style>

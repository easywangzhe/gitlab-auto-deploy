<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useProjectsStore } from '../stores/projects'
import { useDeploymentsStore } from '../stores/deployments'
import { useSettingsStore } from '../stores/settings'
import type { GitLabProject, Deployment, DeploymentStatus } from '../../../shared/types'

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

  // Check if server is configured
  if (!settingsStore.server) {
    ElMessage.warning('请先配置服务器（设置 → 服务器配置）')
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
</script>

<template>
  <div class="project-detail-view" v-loading="loading">
    <el-page-header @back="goBack">
      <template #content>
        <span class="project-title">{{ project?.name || '加载中...' }}</span>
      </template>
      <template #backContent>
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
            <el-button type="primary" @click="startDeploy" :loading="deploying" :disabled="deploying">开始部署</el-button>
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="项目名称">{{ project.name }}</el-descriptions-item>
          <el-descriptions-item label="GitLab 路径">{{ project.gitlabPath }}</el-descriptions-item>
          <el-descriptions-item label="监听分支">{{ project.branch }}</el-descriptions-item>
          <el-descriptions-item label="部署路径">{{ project.deployPath }}</el-descriptions-item>
          <el-descriptions-item label="构建命令">{{ project.buildCommand }}</el-descriptions-item>
          <el-descriptions-item label="输出目录">{{ project.outputDir }}</el-descriptions-item>
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

        <el-table :data="projectDeployments" stripe>
          <el-table-column prop="id" label="ID" width="280" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusColors[row.status]">
                {{ statusLabels[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="进度" width="120">
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
          <el-table-column label="耗时">
            <template #default="{ row }">
              {{ formatDuration(row.startedAt, row.completedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'pending' || row.status === 'cloning' || row.status === 'installing' || row.status === 'building' || row.status === 'uploading' || row.status === 'health_check'"
                size="small"
                type="danger"
                @click="deploymentsStore.cancelDeployment(row.id)"
              >
                取消
              </el-button>
              <el-button 
                v-if="row.status === 'failed'"
                size="small"
                @click="deploymentsStore.rollbackDeployment(row.id)"
              >
                回滚
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-empty v-else description="项目不存在" />
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
}
</style>

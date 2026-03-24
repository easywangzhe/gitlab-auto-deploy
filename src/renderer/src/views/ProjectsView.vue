<script setup lang="ts">
import { ref, onMounted, computed, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectsStore } from '../stores/projects'
import { useSettingsStore } from '../stores/settings'
import type { GitLabProject, GitLabConnection, Server } from '../../../shared/types'

const router = useRouter()
const projectsStore = useProjectsStore()
const settingsStore = useSettingsStore()

const loading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('添加项目')
const editingProject = ref<GitLabProject | null>(null)

const projectForm = ref({
  name: '',
  gitlabId: undefined as number | undefined,
  gitlabPath: '',
  gitlabConnectionId: '',
  serverId: '',
  branch: 'main',
  deployPath: '/var/www/html',
  healthCheckUrl: '',
  outputDir: 'dist',
  buildCommand: '',
  autoDeploy: false
})

const projectList = computed(() => projectsStore.projects)
const gitlabConnections = computed(() => settingsStore.gitlabConnections)
const servers = computed(() => settingsStore.servers)

// Filter and search
const filterConnectionId = ref('')
const filterServerId = ref('')

const filteredProjects = computed(() => {
  let result = projectList.value
  if (filterConnectionId.value) {
    result = result.filter(p => p.gitlabConnectionId === filterConnectionId.value)
  }
  if (filterServerId.value) {
    result = result.filter(p => p.serverId === filterServerId.value)
  }
  return result
})

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([
      projectsStore.loadProjects(),
      settingsStore.loadSettings()
    ])
  } finally {
    loading.value = false
  }
})

const openAddDialog = () => {
  dialogTitle.value = '添加项目'
  editingProject.value = null
  projectForm.value = {
    name: '',
    gitlabId: undefined,
    gitlabPath: '',
    gitlabConnectionId: gitlabConnections.value[0]?.id || '',
    serverId: servers.value[0]?.id || '',
    branch: 'main',
    deployPath: '/var/www/html',
    healthCheckUrl: '',
    outputDir: 'dist',
    buildCommand: '',
    autoDeploy: false
  }
  dialogVisible.value = true
}

const openEditDialog = (project: GitLabProject) => {
  dialogTitle.value = '编辑项目'
  editingProject.value = project
  projectForm.value = {
    name: project.name,
    gitlabId: project.gitlabId,
    gitlabPath: project.gitlabPath,
    gitlabConnectionId: project.gitlabConnectionId,
    serverId: project.serverId,
    branch: project.branch || 'main',
    deployPath: project.deployPath || '/var/www/html',
    healthCheckUrl: project.healthCheckUrl || '',
    outputDir: project.outputDir || 'dist',
    buildCommand: project.buildCommand || '',
    autoDeploy: project.autoDeploy || false
  }
  dialogVisible.value = true
}

const saveProject = async () => {
  // Validation
  if (!projectForm.value.name) {
    ElMessage.warning('请填写项目名称')
    return
  }
  if (!projectForm.value.gitlabPath) {
    ElMessage.warning('请填写 GitLab 路径')
    return
  }
  if (!projectForm.value.gitlabConnectionId) {
    ElMessage.warning('请选择 GitLab 连接')
    return
  }
  if (!projectForm.value.serverId) {
    ElMessage.warning('请选择服务器')
    return
  }

  try {
    const formData = toRaw(projectForm.value)
    if (editingProject.value) {
      await projectsStore.updateProject(editingProject.value.id, formData)
      ElMessage.success('项目已更新')
    } else {
      await projectsStore.createProject(formData)
      ElMessage.success('项目已创建')
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error('保存失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const deleteProject = async (project: GitLabProject) => {
  try {
    await ElMessageBox.confirm(`确定要删除项目 "${project.name}" 吗？`, '确认删除', {
      type: 'warning'
    })
    await projectsStore.deleteProject(project.id)
    ElMessage.success('项目已删除')
  } catch {
    // User cancelled
  }
}

const viewDetail = (project: GitLabProject) => {
  router.push(`/projects/${project.id}`)
}

const formatDate = (date: Date) => {
  return new Date(date).toLocaleString('zh-CN')
}

// Helper functions to get names by ID
const getConnectionName = (id: string): string => {
  return gitlabConnections.value.find(c => c.id === id)?.name || id
}

const getServerName = (id: string): string => {
  return servers.value.find(s => s.id === id)?.name || id
}
</script>

<template>
  <div class="projects-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>项目管理</span>
          <el-button type="primary" @click="openAddDialog" :disabled="gitlabConnections.length === 0 || servers.length === 0">
            <el-icon><Plus /></el-icon>
            添加项目
          </el-button>
        </div>
      </template>

      <!-- Filters -->
      <div class="filters" v-if="projectList.length > 0">
        <el-select v-model="filterConnectionId" placeholder="全部 GitLab" clearable style="width: 200px">
          <el-option
            v-for="conn in gitlabConnections"
            :key="conn.id"
            :label="conn.name"
            :value="conn.id"
          />
        </el-select>
        <el-select v-model="filterServerId" placeholder="全部服务器" clearable style="width: 200px; margin-left: 12px">
          <el-option
            v-for="server in servers"
            :key="server.id"
            :label="server.name"
            :value="server.id"
          />
        </el-select>
      </div>

      <el-empty v-if="projectList.length === 0" description="暂无项目">
        <el-button type="primary" @click="openAddDialog" :disabled="gitlabConnections.length === 0 || servers.length === 0">
          添加项目
        </el-button>
        <div class="empty-tip" v-if="gitlabConnections.length === 0 || servers.length === 0">
          <el-alert type="warning" :closable="false" style="margin-top: 16px">
            请先配置 GitLab 连接和服务器
          </el-alert>
        </div>
      </el-empty>

      <el-table v-else :data="filteredProjects" v-loading="loading" stripe>
        <el-table-column prop="name" label="项目名称" min-width="150" />
        <el-table-column prop="gitlabPath" label="GitLab 路径" min-width="180" />
        <el-table-column label="GitLab" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ getConnectionName(row.gitlabConnectionId) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="服务器" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ getServerName(row.serverId) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="branch" label="分支" width="100" />
        <el-table-column label="自动部署" width="100">
          <template #default="{ row }">
            <el-tag :type="row.autoDeploy ? 'success' : 'info'" size="small">
              {{ row.autoDeploy ? '已启用' : '未启用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="viewDetail(row)">详情</el-button>
            <el-button size="small" link @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteProject(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="550px">
      <el-form :model="projectForm" label-width="110px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectForm.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="GitLab 连接" required>
          <el-select v-model="projectForm.gitlabConnectionId" placeholder="选择 GitLab 连接" style="width: 100%">
            <el-option
              v-for="conn in gitlabConnections"
              :key="conn.id"
              :label="conn.name"
              :value="conn.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="GitLab 路径" required>
          <el-input v-model="projectForm.gitlabPath" placeholder="例如: group/project" />
        </el-form-item>
        <el-form-item label="GitLab ID" required>
          <el-input-number v-model="projectForm.gitlabId" :min="1" placeholder="GitLab 项目数字 ID" style="width: 100%" />
          <div class="form-tip">GitLab 项目的数字 ID，可在 GitLab 项目设置中查看</div>
        </el-form-item>
        <el-form-item label="服务器" required>
          <el-select v-model="projectForm.serverId" placeholder="选择部署服务器" style="width: 100%">
            <el-option
              v-for="server in servers"
              :key="server.id"
              :label="server.name"
              :value="server.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="分支">
          <el-input v-model="projectForm.branch" placeholder="默认: main" />
        </el-form-item>
        <el-form-item label="部署路径">
          <el-input v-model="projectForm.deployPath" placeholder="服务器上的部署路径" />
        </el-form-item>
        <el-form-item label="健康检查URL">
          <el-input v-model="projectForm.healthCheckUrl" placeholder="例如: https://example.com/health" />
          <div class="form-tip">部署完成后会检查此URL是否返回200状态码，支持重定向</div>
        </el-form-item>
        <el-form-item label="输出目录">
          <el-input v-model="projectForm.outputDir" placeholder="例如: dist" />
        </el-form-item>
        <el-form-item label="构建命令">
          <el-input v-model="projectForm.buildCommand" placeholder="例如: npm run build:prod (留空自动检测)" />
          <div class="form-tip">留空将自动从 package.json 检测构建命令</div>
        </el-form-item>
        <el-form-item label="自动部署">
          <el-switch v-model="projectForm.autoDeploy" />
          <div class="form-tip">开启后，守护进程会自动监控此项目的 MR 合并并触发部署</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProject">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.projects-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .filters {
    margin-bottom: 16px;
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
  }

  .empty-tip {
    margin-top: 16px;
  }
}
</style>
<script setup lang="ts">
import { ref, onMounted, computed, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectsStore } from '../stores/projects'
import type { GitLabProject, DeploymentConfig } from '../../../shared/types'

const router = useRouter()
const projectsStore = useProjectsStore()

const loading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('添加项目')
const editingProject = ref<GitLabProject | null>(null)

const projectForm = ref({
  name: '',
  gitlabId: undefined as number | undefined,
  gitlabPath: '',
  branch: 'main',
  deployPath: '/var/www/html',
  healthCheckUrl: '',
  outputDir: 'dist',
  autoDeploy: false
})

const projectList = computed(() => projectsStore.projects)

onMounted(async () => {
  loading.value = true
  try {
    await projectsStore.loadProjects()
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
    branch: 'main',
    deployPath: '/var/www/html',
    healthCheckUrl: '',
    outputDir: 'dist',
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
    branch: project.branch || 'main',
    deployPath: project.deployPath || '/var/www/html',
    healthCheckUrl: project.healthCheckUrl || '',
    outputDir: project.outputDir || 'dist',
    autoDeploy: project.autoDeploy || false
  }
  dialogVisible.value = true
}

const saveProject = async () => {
  try {
    // Convert reactive form to plain object for IPC serialization
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
</script>

<template>
  <div class="projects-view">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>项目管理</span>
          <el-button type="primary" @click="openAddDialog">添加项目</el-button>
        </div>
      </template>

      <el-table :data="projectList" v-loading="loading" stripe>
        <el-table-column prop="name" label="项目名称" min-width="150" />
        <el-table-column prop="gitlabPath" label="GitLab 路径" min-width="180" />
        <el-table-column prop="branch" label="分支" width="100" />
        <el-table-column prop="deployPath" label="部署路径" min-width="180" />
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
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="viewDetail(row)">详情</el-button>
            <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteProject(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form :model="projectForm" label-width="100px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectForm.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="GitLab 路径" required>
          <el-input v-model="projectForm.gitlabPath" placeholder="例如: group/project" />
        </el-form-item>
        <el-form-item label="GitLab ID" required>
          <el-input-number v-model="projectForm.gitlabId" :min="1" placeholder="GitLab 项目数字 ID" style="width: 100%" />
          <div class="form-tip">GitLab 项目的数字 ID，可在 GitLab 项目设置中查看</div>
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

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
  }
}
</style>

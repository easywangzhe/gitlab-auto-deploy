<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { GitLabConnection } from '../../../shared/types'

const connections = ref<GitLabConnection[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const testing = ref(false)
const editingId = ref<string | null>(null)

const connectionForm = ref({
  name: '',
  apiUrl: 'https://gitlab.com',
  token: ''
})

const dialogTitle = computed(() => editingId.value ? '编辑 GitLab 连接' : '添加 GitLab 连接')

onMounted(async () => {
  await loadConnections()
})

const loadConnections = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI?.getGitLabConnections()
    if (result?.success) {
      connections.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载连接列表失败')
  } finally {
    loading.value = false
  }
}

const openAddDialog = () => {
  editingId.value = null
  connectionForm.value = {
    name: '',
    apiUrl: 'https://gitlab.com',
    token: ''
  }
  dialogVisible.value = true
}

const openEditDialog = (connection: GitLabConnection) => {
  editingId.value = connection.id
  connectionForm.value = {
    name: connection.name,
    apiUrl: connection.apiUrl,
    token: '' // Token is not returned for security
  }
  dialogVisible.value = true
}

const testConnection = async () => {
  if (!connectionForm.value.apiUrl || !connectionForm.value.token) {
    ElMessage.warning('请填写 API URL 和 Token')
    return
  }

  testing.value = true
  try {
    const result = await window.electronAPI?.testGitLabConnection(
      connectionForm.value.apiUrl,
      connectionForm.value.token
    )
    if (result?.success && result.data) {
      ElMessage.success('连接测试成功')
    } else {
      ElMessage.error('连接测试失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    ElMessage.error('连接测试失败')
  } finally {
    testing.value = false
  }
}

const saveConnection = async () => {
  if (!connectionForm.value.name) {
    ElMessage.warning('请填写连接名称')
    return
  }
  if (!connectionForm.value.apiUrl) {
    ElMessage.warning('请填写 API URL')
    return
  }
  if (!editingId.value && !connectionForm.value.token) {
    ElMessage.warning('请填写 Access Token')
    return
  }

  try {
    let result
    if (editingId.value) {
      // Update existing connection
      const updates: Partial<GitLabConnection> = {
        name: connectionForm.value.name,
        apiUrl: connectionForm.value.apiUrl
      }
      // Only include token if provided
      if (connectionForm.value.token) {
        updates.token = connectionForm.value.token
      }
      result = await window.electronAPI?.updateGitLabConnection(editingId.value, updates)
    } else {
      // Create new connection
      result = await window.electronAPI?.createGitLabConnection({
        name: connectionForm.value.name,
        apiUrl: connectionForm.value.apiUrl,
        token: connectionForm.value.token
      })
    }

    if (result?.success) {
      ElMessage.success(editingId.value ? '连接已更新' : '连接已添加')
      dialogVisible.value = false
      await loadConnections()
    } else {
      ElMessage.error('保存失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    ElMessage.error('保存失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const deleteConnection = async (connection: GitLabConnection) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除连接 "${connection.name}" 吗？删除后无法恢复。`,
      '确认删除',
      { type: 'warning' }
    )

    const result = await window.electronAPI?.deleteGitLabConnection(connection.id)
    if (result?.success) {
      ElMessage.success('连接已删除')
      await loadConnections()
    } else {
      ElMessage.error('删除失败: ' + (result?.error || '未知错误'))
    }
  } catch {
    // User cancelled
  }
}
</script>

<template>
  <div class="gitlab-connections-view" v-loading="loading">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>GitLab 连接管理</span>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon>
            添加连接
          </el-button>
        </div>
      </template>

      <el-empty v-if="connections.length === 0" description="暂无 GitLab 连接，请添加">
        <el-button type="primary" @click="openAddDialog">添加连接</el-button>
      </el-empty>

      <el-table v-else :data="connections" stripe>
        <el-table-column prop="name" label="连接名称" min-width="150" />
        <el-table-column prop="apiUrl" label="API URL" min-width="300" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteConnection(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form :model="connectionForm" label-width="120px">
        <el-form-item label="连接名称" required>
          <el-input v-model="connectionForm.name" placeholder="例如: 公司 GitLab" />
        </el-form-item>
        <el-form-item label="API URL" required>
          <el-input v-model="connectionForm.apiUrl" placeholder="https://gitlab.com" />
        </el-form-item>
        <el-form-item label="Access Token" :required="!editingId">
          <el-input
            v-model="connectionForm.token"
            type="password"
            show-password
            :placeholder="editingId ? '留空保持不变' : 'GitLab Personal Access Token'"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button @click="testConnection" :loading="testing">测试连接</el-button>
        <el-button type="primary" @click="saveConnection">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.gitlab-connections-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
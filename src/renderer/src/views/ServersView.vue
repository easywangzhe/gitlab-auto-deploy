<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Server } from '../../../shared/types'

const servers = ref<Server[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const testing = ref(false)
const editingId = ref<string | null>(null)

const serverForm = ref({
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'privateKey' as 'privateKey' | 'password',
  password: ''
})

const dialogTitle = computed(() => editingId.value ? '编辑服务器' : '添加服务器')

onMounted(async () => {
  await loadServers()
})

const loadServers = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI?.getServers()
    if (result?.success) {
      servers.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载服务器列表失败')
  } finally {
    loading.value = false
  }
}

const openAddDialog = () => {
  editingId.value = null
  serverForm.value = {
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'privateKey',
    password: ''
  }
  dialogVisible.value = true
}

const openEditDialog = (server: Server) => {
  editingId.value = server.id
  serverForm.value = {
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    authType: server.authType || 'privateKey',
    password: '' // Password not returned for security
  }
  dialogVisible.value = true
}

const testConnection = async () => {
  if (!serverForm.value.host || !serverForm.value.username) {
    ElMessage.warning('请填写主机地址和用户名')
    return
  }

  testing.value = true
  try {
    const result = await window.electronAPI?.testSSHConnection(
      serverForm.value.host,
      serverForm.value.port,
      serverForm.value.username,
      serverForm.value.authType,
      serverForm.value.authType === 'privateKey' ? '' : undefined,
      serverForm.value.authType === 'password' ? serverForm.value.password : undefined
    )
    if (result?.success && result.data) {
      ElMessage.success('SSH 连接测试成功')
    } else {
      ElMessage.error('SSH 连接测试失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    ElMessage.error('SSH 连接测试失败')
  } finally {
    testing.value = false
  }
}

const saveServer = async () => {
  if (!serverForm.value.name) {
    ElMessage.warning('请填写服务器名称')
    return
  }
  if (!serverForm.value.host) {
    ElMessage.warning('请填写主机地址')
    return
  }
  if (!serverForm.value.username) {
    ElMessage.warning('请填写用户名')
    return
  }
  if (!editingId.value && serverForm.value.authType === 'password' && !serverForm.value.password) {
    ElMessage.warning('请填写密码')
    return
  }

  try {
    let result
    if (editingId.value) {
      // Update existing server
      const updates: Partial<Server> = {
        name: serverForm.value.name,
        host: serverForm.value.host,
        port: serverForm.value.port,
        username: serverForm.value.username,
        authType: serverForm.value.authType
      }
      // Only include password if provided
      if (serverForm.value.authType === 'password' && serverForm.value.password) {
        updates.password = serverForm.value.password
      }
      result = await window.electronAPI?.updateServer(editingId.value, updates)
    } else {
      // Create new server
      result = await window.electronAPI?.createServer({
        name: serverForm.value.name,
        host: serverForm.value.host,
        port: serverForm.value.port,
        username: serverForm.value.username,
        authType: serverForm.value.authType,
        password: serverForm.value.authType === 'password' ? serverForm.value.password : undefined
      })
    }

    if (result?.success) {
      ElMessage.success(editingId.value ? '服务器已更新' : '服务器已添加')
      dialogVisible.value = false
      await loadServers()
    } else {
      ElMessage.error('保存失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    ElMessage.error('保存失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const deleteServer = async (server: Server) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除服务器 "${server.name}" 吗？删除后无法恢复。`,
      '确认删除',
      { type: 'warning' }
    )

    const result = await window.electronAPI?.deleteServer(server.id)
    if (result?.success) {
      ElMessage.success('服务器已删除')
      await loadServers()
    } else {
      ElMessage.error('删除失败: ' + (result?.error || '未知错误'))
    }
  } catch {
    // User cancelled
  }
}
</script>

<template>
  <div class="servers-view" v-loading="loading">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>服务器管理</span>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon>
            添加服务器
          </el-button>
        </div>
      </template>

      <el-empty v-if="servers.length === 0" description="暂无服务器配置，请添加">
        <el-button type="primary" @click="openAddDialog">添加服务器</el-button>
      </el-empty>

      <el-table v-else :data="servers" stripe>
        <el-table-column prop="name" label="服务器名称" min-width="150" />
        <el-table-column prop="host" label="主机地址" min-width="180" />
        <el-table-column prop="port" label="SSH 端口" width="100" />
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column label="认证方式" width="100">
          <template #default="{ row }">
            <el-tag :type="row.authType === 'privateKey' ? 'primary' : 'warning'" size="small">
              {{ row.authType === 'privateKey' ? '私钥' : '密码' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteServer(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form :model="serverForm" label-width="100px">
        <el-form-item label="服务器名称" required>
          <el-input v-model="serverForm.name" placeholder="例如: 生产服务器" />
        </el-form-item>
        <el-form-item label="主机地址" required>
          <el-input v-model="serverForm.host" placeholder="例如: 192.168.1.100" />
        </el-form-item>
        <el-form-item label="SSH 端口">
          <el-input-number v-model="serverForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名" required>
          <el-input v-model="serverForm.username" placeholder="SSH 用户名" />
        </el-form-item>
        <el-form-item label="认证方式" required>
          <el-radio-group v-model="serverForm.authType">
            <el-radio value="privateKey">私钥认证</el-radio>
            <el-radio value="password">密码认证</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="serverForm.authType === 'password'" label="密码" :required="!editingId">
          <el-input
            v-model="serverForm.password"
            type="password"
            show-password
            :placeholder="editingId ? '留空保持不变' : 'SSH 密码'"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button @click="testConnection" :loading="testing">测试连接</el-button>
        <el-button type="primary" @click="saveServer">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.servers-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
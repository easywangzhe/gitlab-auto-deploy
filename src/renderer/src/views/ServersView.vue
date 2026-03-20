<script setup lang="ts">
import { ref, onMounted, computed, toRaw, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()

const loading = ref(false)
const testing = ref(false)
const hasPassword = ref(false)

const serverForm = ref({
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'privateKey' as 'privateKey' | 'password',
  password: ''
})

const hasServer = computed(() => !!settingsStore.server)

// Watch for settings changes to update form
watch(() => settingsStore.server, (server) => {
  if (server) {
    serverForm.value = {
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType || 'privateKey',
      password: '' // Password not returned for security
    }
    hasPassword.value = server.authType === 'password' && !!server.password
  }
}, { immediate: true })

onMounted(async () => {
  loading.value = true
  try {
    await settingsStore.loadSettings()
    // Load existing server into form
    if (settingsStore.server) {
      serverForm.value = {
        name: settingsStore.server.name,
        host: settingsStore.server.host,
        port: settingsStore.server.port,
        username: settingsStore.server.username,
        authType: settingsStore.server.authType || 'privateKey',
        password: '' // Password not returned for security
      }
      hasPassword.value = settingsStore.server.authType === 'password' && !!settingsStore.server.password
    }
  } finally {
    loading.value = false
  }
})

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
  try {
    const formData = toRaw(serverForm.value)
    // If password is empty and we had a password before, keep the existing one
    if (formData.authType === 'password' && !formData.password && hasPassword.value && settingsStore.server?.password) {
      formData.password = settingsStore.server.password
    }
    await settingsStore.saveServer(formData)
    if (formData.authType === 'password') {
      hasPassword.value = true
    }
    ElMessage.success(hasServer.value ? '服务器已更新' : '服务器已保存')
  } catch (error) {
    ElMessage.error('保存失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const clearServer = async () => {
  try {
    await ElMessageBox.confirm('确定要清除服务器配置吗？', '确认清除', {
      type: 'warning'
    })
    await settingsStore.clearServer()
    serverForm.value = {
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'privateKey',
      password: ''
    }
    hasPassword.value = false
    ElMessage.success('服务器配置已清除')
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
          <span>服务器配置</span>
        </div>
      </template>

      <el-form :model="serverForm" label-width="120px" class="server-form">
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
        <el-form-item v-if="serverForm.authType === 'password'" label="密码" required>
          <el-input v-model="serverForm.password" type="password" :placeholder="hasPassword ? '已保存 (留空保持不变)' : 'SSH 密码'" show-password />
        </el-form-item>
        <el-form-item>
          <el-button @click="testConnection" :loading="testing">测试连接</el-button>
          <el-button type="primary" @click="saveServer">保存配置</el-button>
          <el-button v-if="hasServer" type="danger" @click="clearServer">清除配置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.servers-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .server-form {
    max-width: 600px;
  }
}
</style>
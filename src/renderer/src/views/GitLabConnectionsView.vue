<script setup lang="ts">
import { ref, onMounted, computed, toRaw } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()

const loading = ref(false)
const testing = ref(false)

const connectionForm = ref({
  name: '',
  apiUrl: 'https://gitlab.com',
  token: ''
})

const hasConnection = computed(() => !!settingsStore.gitlabConnection)

const hasToken = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await settingsStore.loadSettings()
    // Load existing connection into form
    if (settingsStore.gitlabConnection) {
      connectionForm.value = {
        name: settingsStore.gitlabConnection.name,
        apiUrl: settingsStore.gitlabConnection.apiUrl,
        token: '' // Token is not returned for security
      }
      hasToken.value = true
    }
  } finally {
    loading.value = false
  }
})

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
  try {
    const formData = toRaw(connectionForm.value)
    // If token is empty and we had a token before, keep the existing one
    if (!formData.token && hasToken.value && settingsStore.gitlabConnection) {
      formData.token = settingsStore.gitlabConnection.token
    }
    await settingsStore.saveGitLabConnection(formData)
    hasToken.value = true
    ElMessage.success(hasConnection.value ? '连接已更新' : '连接已保存')
  } catch (error) {
    ElMessage.error('保存失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const clearConnection = async () => {
  try {
    await ElMessageBox.confirm('确定要清除 GitLab 连接配置吗？', '确认清除', {
      type: 'warning'
    })
    await settingsStore.clearGitLabConnection()
    connectionForm.value = {
      name: '',
      apiUrl: 'https://gitlab.com',
      token: ''
    }
    hasToken.value = false
    ElMessage.success('连接已清除')
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
          <span>GitLab 连接配置</span>
        </div>
      </template>

      <el-form :model="connectionForm" label-width="120px" class="connection-form">
        <el-form-item label="连接名称" required>
          <el-input v-model="connectionForm.name" placeholder="例如: 公司 GitLab" />
        </el-form-item>
        <el-form-item label="API URL" required>
          <el-input v-model="connectionForm.apiUrl" placeholder="https://gitlab.com" />
        </el-form-item>
        <el-form-item label="Access Token" required>
          <el-input
            v-model="connectionForm.token"
            type="password"
            show-password
            :placeholder="hasToken ? '已保存 (留空保持不变)' : 'GitLab Personal Access Token'"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="testConnection" :loading="testing">测试连接</el-button>
          <el-button type="primary" @click="saveConnection">保存配置</el-button>
          <el-button v-if="hasConnection" type="danger" @click="clearConnection">清除配置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.gitlab-connections-view {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .connection-form {
    max-width: 600px;
  }
}
</style>
<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const settingsStore = useSettingsStore()

const loading = ref(false)
const daemonLoading = ref(false)

const settings = computed(() => settingsStore.settings)

const daemonEnabled = ref(false)
const pollingInterval = ref(60000)
const notifyOnSuccess = ref(true)
const notifyOnFailure = ref(true)

onMounted(async () => {
  loading.value = true
  try {
    await settingsStore.loadSettings()
    if (settings.value?.daemon) {
      daemonEnabled.value = settings.value.daemon.enabled
      pollingInterval.value = settings.value.daemon.pollingInterval || 60000
    }
    if (settings.value?.notifications) {
      notifyOnSuccess.value = settings.value.notifications.notifyOnSuccess ?? true
      notifyOnFailure.value = settings.value.notifications.notifyOnFailure ?? true
    }
  } finally {
    loading.value = false
  }
})

// 自动保存设置的函数
const autoSaveSettings = async (startStopDaemon = false) => {
  try {
    const currentSettings = settings.value ? JSON.parse(JSON.stringify(settings.value)) : {}
    await settingsStore.saveSettings({
      ...currentSettings,
      daemon: {
        enabled: daemonEnabled.value,
        pollingInterval: pollingInterval.value
      },
      notifications: {
        enabled: true,
        notifyOnSuccess: notifyOnSuccess.value,
        notifyOnFailure: notifyOnFailure.value
      }
    })
  } catch (error) {
    ElMessage.error('保存设置失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

// 监听守护进程开关变化，直接启动/停止守护进程
const onDaemonEnabledChange = async (enabled: boolean) => {
  daemonLoading.value = true
  try {
    if (enabled) {
      const result = await window.electronAPI.startDaemon()
      if (result.success) {
        ElMessage.success('守护进程已启动')
      } else {
        daemonEnabled.value = false
        ElMessage.error('启动失败: ' + (result.error || '未知错误'))
        return
      }
    } else {
      const result = await window.electronAPI.stopDaemon()
      if (result.success) {
        ElMessage.success('守护进程已停止')
      } else {
        daemonEnabled.value = true
        ElMessage.error('停止失败: ' + (result.error || '未知错误'))
        return
      }
    }
    // 保存设置
    await autoSaveSettings()
  } catch (error) {
    daemonEnabled.value = !enabled
    ElMessage.error((enabled ? '启动' : '停止') + '失败: ' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    daemonLoading.value = false
  }
}

// 监听其他设置变化，自动保存
watch([pollingInterval, notifyOnSuccess, notifyOnFailure], () => {
  autoSaveSettings()
})

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<template>
  <div class="settings-view" v-loading="loading">
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card class="menu-card">
          <el-menu default-active="general">
            <el-menu-item index="general">
              <el-icon><Setting /></el-icon>
              <span>常规设置</span>
            </el-menu-item>
            <el-menu-item index="connections" @click="navigateTo('/settings/connections')">
              <el-icon><Connection /></el-icon>
              <span>GitLab 连接</span>
            </el-menu-item>
            <el-menu-item index="servers" @click="navigateTo('/settings/servers')">
              <el-icon><Monitor /></el-icon>
              <span>服务器管理</span>
            </el-menu-item>
          </el-menu>
        </el-card>
      </el-col>

      <el-col :span="18">
        <el-card>
          <template #header>
            <span>常规设置</span>
          </template>

          <el-form label-width="120px">
            <el-divider content-position="left">守护进程</el-divider>

            <el-form-item label="启用守护进程">
              <el-switch v-model="daemonEnabled" :loading="daemonLoading" @change="onDaemonEnabledChange" />
              <div class="form-tip">启用后将自动监听 GitLab 项目的 MR 合并事件并触发自动部署</div>
            </el-form-item>

            <el-form-item label="轮询间隔">
              <el-select v-model="pollingInterval" :disabled="!daemonEnabled">
                <el-option label="30 秒" :value="30000" />
                <el-option label="1 分钟" :value="60000" />
                <el-option label="5 分钟" :value="300000" />
                <el-option label="10 分钟" :value="600000" />
              </el-select>
              <div class="form-tip">检查 GitLab 更新的频率</div>
            </el-form-item>

            <el-divider content-position="left">通知设置</el-divider>

            <el-form-item label="部署成功通知">
              <el-switch v-model="notifyOnSuccess" />
            </el-form-item>

            <el-form-item label="部署失败通知">
              <el-switch v-model="notifyOnFailure" />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped lang="scss">
.settings-view {
  .menu-card {
    :deep(.el-card__body) {
      padding: 0;
    }
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 5px;
  }
}
</style>

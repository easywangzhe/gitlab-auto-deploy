<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { ElMessage } from 'element-plus'

type LogCategory = 'gitlab-poll' | 'build' | 'deploy' | 'daemon'
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  category: LogCategory
  message: string
  data?: Record<string, unknown>
}

const activeCategory = ref<LogCategory>('gitlab-poll')
const logs = ref<LogEntry[]>([])
const stats = ref<Record<LogCategory, { count: number; maxSize: number }>>()
const autoRefresh = ref(true)
const refreshInterval = ref<number>()
const limit = ref(100)

const categoryLabels: Record<LogCategory, string> = {
  'gitlab-poll': 'GitLab 轮询',
  'build': '构建',
  'deploy': '部署',
  'daemon': '守护进程'
}

const levelColors: Record<LogLevel, string> = {
  debug: '#909399',
  info: '#409EFF',
  warn: '#E6A23C',
  error: '#F56C6C'
}

const filteredLogs = computed(() => {
  return logs.value
})

const loadLogs = async () => {
  try {
    const result = await window.electronAPI.getLogs(activeCategory.value, limit.value)
    if (result.success && result.data) {
      logs.value = result.data
    }
  } catch (error) {
    console.error('Failed to load logs:', error)
  }
}

const loadStats = async () => {
  try {
    const result = await window.electronAPI.getLogStats()
    if (result.success && result.data) {
      stats.value = result.data
    }
  } catch (error) {
    console.error('Failed to load stats:', error)
  }
}

const clearLogs = async () => {
  try {
    const result = await window.electronAPI.clearLogs(activeCategory.value)
    if (result.success) {
      ElMessage.success('日志已清除')
      loadLogs()
      loadStats()
    }
  } catch (error) {
    ElMessage.error('清除日志失败')
  }
}

const clearAllLogs = async () => {
  try {
    const result = await window.electronAPI.clearAllLogs()
    if (result.success) {
      ElMessage.success('所有日志已清除')
      loadLogs()
      loadStats()
    }
  } catch (error) {
    ElMessage.error('清除日志失败')
  }
}

const formatTime = (date: Date) => {
  const d = new Date(date)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const formatData = (data?: Record<string, unknown>) => {
  if (!data || Object.keys(data).length === 0) return ''
  return JSON.stringify(data, null, 2)
}

const handleCategoryChange = () => {
  loadLogs()
}

onMounted(() => {
  loadLogs()
  loadStats()

  if (autoRefresh.value) {
    refreshInterval.value = window.setInterval(() => {
      loadLogs()
      loadStats()
    }, 5000)
  }
})

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
  }
})
</script>

<template>
  <div class="logs-view">
    <el-card class="logs-card">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <span class="title">系统日志</span>
            <el-radio-group v-model="activeCategory" size="small" @change="handleCategoryChange">
              <el-radio-button label="gitlab-poll">GitLab 轮询</el-radio-button>
              <el-radio-button label="build">构建</el-radio-button>
              <el-radio-button label="deploy">部署</el-radio-button>
              <el-radio-button label="daemon">守护进程</el-radio-button>
            </el-radio-group>
          </div>
          <div class="header-right">
            <el-switch v-model="autoRefresh" active-text="自动刷新" />
            <el-button type="danger" size="small" @click="clearLogs">清除当前</el-button>
            <el-button type="danger" size="small" plain @click="clearAllLogs">清除全部</el-button>
          </div>
        </div>
      </template>

      <!-- Stats -->
      <div v-if="stats" class="log-stats">
        <el-tag v-for="(stat, cat) in stats" :key="cat" size="small" type="info">
          {{ categoryLabels[cat as LogCategory] }}: {{ stat.count }}/{{ stat.maxSize }}
        </el-tag>
      </div>

      <!-- Logs List -->
      <div class="logs-list">
        <el-empty v-if="filteredLogs.length === 0" description="暂无日志" />
        <div v-else class="logs-container">
          <div
            v-for="log in filteredLogs"
            :key="log.id"
            class="log-entry"
            :class="`log-level-${log.level}`"
          >
            <div class="log-header">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <el-tag
                :color="levelColors[log.level]"
                size="small"
                effect="dark"
                class="log-level"
              >
                {{ log.level.toUpperCase() }}
              </el-tag>
              <el-tag size="small" type="info" class="log-category">
                {{ categoryLabels[log.category] }}
              </el-tag>
            </div>
            <div class="log-message">{{ log.message }}</div>
            <pre v-if="log.data && Object.keys(log.data).length > 0" class="log-data">{{ formatData(log.data) }}</pre>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.logs-view {
  height: 100%;

  .logs-card {
    height: 100%;
    display: flex;
    flex-direction: column;

    :deep(.el-card__header) {
      padding: 12px 20px;
      border-bottom: 1px solid #ebeef5;
    }

    :deep(.el-card__body) {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 0;
    }
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;

      .title {
        font-size: 16px;
        font-weight: 600;
      }
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
  }

  .log-stats {
    padding: 12px 20px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    border-bottom: 1px solid #ebeef5;
    background: #fafafa;
  }

  .logs-list {
    flex: 1;
    overflow: auto;
    padding: 12px;
  }

  .logs-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .log-entry {
    padding: 10px 12px;
    border-radius: 4px;
    background: #fafafa;
    border-left: 3px solid #909399;

    &.log-level-info {
      border-left-color: #409EFF;
    }

    &.log-level-warn {
      border-left-color: #E6A23C;
      background: #fdf6ec;
    }

    &.log-level-error {
      border-left-color: #F56C6C;
      background: #fef0f0;
    }

    .log-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;

      .log-time {
        font-size: 12px;
        color: #909399;
        font-family: monospace;
      }

      .log-level {
        font-size: 10px;
      }

      .log-category {
        font-size: 11px;
      }
    }

    .log-message {
      font-size: 13px;
      color: #303133;
      line-height: 1.5;
    }

    .log-data {
      margin-top: 8px;
      padding: 8px;
      background: #f5f7fa;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
  }
}

/* Dark mode styles */
html.dark {
  .logs-view {
    .logs-card {
      :deep(.el-card__header) {
        border-bottom-color: #333;
      }
    }

    .log-stats {
      border-bottom-color: #333;
      background: #1d1d1d;
    }

    .log-entry {
      background: #1d1d1d;

      .log-message {
        color: #e5eaf3;
      }

      .log-data {
        background: #0d0d0d;
        color: #e5eaf3;
      }

      &.log-level-warn {
        background: #2a2518;
      }

      &.log-level-error {
        background: #2a1a1a;
      }
    }
  }
}
</style>
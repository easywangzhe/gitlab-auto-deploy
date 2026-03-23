<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from './stores/settings'
import logoSvg from './assets/logo.svg'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()

const currentPath = computed(() => route.path)

const navigateTo = (path: string) => {
  router.push(path)
}

// 主题初始化和应用
const applyTheme = (themeValue: 'light' | 'dark' | 'auto') => {
  const html = document.documentElement
  let isDark = false

  if (themeValue === 'dark') {
    isDark = true
  } else if (themeValue === 'auto') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  if (isDark) {
    html.classList.add('dark')
  } else {
    html.classList.remove('dark')
  }
}

// 监听系统主题变化
let mediaQuery: MediaQueryList | null = null
const handleSystemThemeChange = () => {
  const theme = settingsStore.settings?.theme || 'auto'
  if (theme === 'auto') {
    applyTheme('auto')
  }
}

onMounted(async () => {
  // 加载设置并应用主题
  await settingsStore.loadSettings()
  const theme = settingsStore.settings?.theme || 'auto'
  applyTheme(theme)

  // 监听系统主题变化
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', handleSystemThemeChange)
})

// 监听主题设置变化
watch(() => settingsStore.settings?.theme, (newTheme) => {
  if (newTheme) {
    applyTheme(newTheme)
  }
})
</script>

<template>
  <el-container class="app-layout">
    <!-- Sidebar -->
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <img :src="logoSvg" alt="Logo" class="logo-icon" />
        <span>GitLab 自动部署</span>
      </div>

      <el-menu
        :default-active="currentPath"
        class="sidebar-menu"
        router
      >
        <el-menu-item index="/projects">
          <el-icon><Folder /></el-icon>
          <span>项目管理</span>
        </el-menu-item>

        <el-menu-item index="/deployments">
          <el-icon><Upload /></el-icon>
          <span>部署队列</span>
        </el-menu-item>

        <el-menu-item index="/logs">
          <el-icon><Document /></el-icon>
          <span>系统日志</span>
        </el-menu-item>

        <el-sub-menu index="settings">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>系统设置</span>
          </template>
          <el-menu-item index="/settings">
            <el-icon><Tools /></el-icon>
            <span>常规设置</span>
          </el-menu-item>
          <el-menu-item index="/settings/connections">
            <el-icon><Connection /></el-icon>
            <span>GitLab 连接</span>
          </el-menu-item>
          <el-menu-item index="/settings/servers">
            <el-icon><Monitor /></el-icon>
            <span>服务器管理</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>

      <div class="sidebar-footer">
        <el-tag size="small" type="info">v1.0.0</el-tag>
      </div>
    </el-aside>

    <!-- Main Content -->
    <el-container class="main-container">
      <el-header class="app-header">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/projects' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta?.title">
              {{ route.meta.title }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-button text @click="navigateTo('/settings')">
            <el-icon><Setting /></el-icon>
          </el-button>
        </div>
      </el-header>

      <el-main class="app-main">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style lang="scss">
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.app-layout {
  height: 100%;
  width: 100%;
}

.sidebar {
  background-color: #304156;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .logo {
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #fff;
    font-size: 18px;
    font-weight: 600;
    border-bottom: 1px solid #3a4758;

    .logo-icon {
      width: 28px;
      height: 28px;
    }

    .el-icon {
      color: #409eff;
    }
  }

  .sidebar-menu {
    flex: 1;
    border-right: none;
    overflow-y: auto;
    background-color: #304156;

    &:not(.el-menu--collapse) {
      width: 100%;
    }

    .el-menu-item {
      color: #bfcbd9;

      &:hover {
        background-color: #263445 !important;
      }

      &.is-active {
        background-color: #263445 !important;
        border-right: 3px solid #409eff;
        color: #409eff;
      }
    }

    .el-sub-menu {
      .el-sub-menu__title {
        color: #bfcbd9 !important;

        &:hover {
          background-color: #263445 !important;
        }
      }

      &.is-active {
        .el-sub-menu__title {
          color: #409eff !important;
        }
      }

      .el-menu {
        background-color: #1f2d3d !important;
      }

      .el-menu-item {
        padding-left: 50px !important;
        min-width: auto;
        color: #bfcbd9;

        &:hover {
          background-color: #001528 !important;
        }

        &.is-active {
          background-color: #263445 !important;
          color: #409eff;
        }
      }
    }
  }

  .sidebar-footer {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid #3a4758;
  }
}

.main-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-header {
  height: 60px;
  background-color: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;

  .header-left {
    display: flex;
    align-items: center;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
}

.app-main {
  flex: 1;
  overflow: auto;
  background-color: #f5f7fa;
  padding: 20px;
}

// Page transition animation
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Dark mode styles */
html.dark {
  .sidebar {
    background-color: #1d1d1d;

    .logo {
      border-bottom-color: #333;
    }

    .sidebar-menu {
      background-color: #1d1d1d;

      .el-menu-item {
        color: #e5eaf3;

        &:hover {
          background-color: #252525 !important;
        }

        &.is-active {
          background-color: #252525 !important;
        }
      }

      .el-sub-menu {
        .el-sub-menu__title {
          color: #e5eaf3 !important;

          &:hover {
            background-color: #252525 !important;
          }
        }

        .el-menu {
          background-color: #141414 !important;
        }

        .el-menu-item {
          color: #e5eaf3;

          &:hover {
            background-color: #0a0a0a !important;
          }
        }
      }
    }

    .sidebar-footer {
      border-top-color: #333;
    }
  }

  .app-header {
    background-color: #1d1d1d;
    border-bottom-color: #333;
    color: #e5eaf3;
  }

  .app-main {
    background-color: #141414;
  }
}
</style>
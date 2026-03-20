<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const currentPath = computed(() => route.path)

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<template>
  <el-container class="app-layout">
    <!-- Sidebar -->
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon size="24"><Upload /></el-icon>
        <span>GitLab 自动部署</span>
      </div>

      <el-menu
        :default-active="currentPath"
        class="sidebar-menu"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
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

    .el-icon {
      color: #409eff;
    }
  }

  .sidebar-menu {
    flex: 1;
    border-right: none;
    overflow-y: auto;

    &:not(.el-menu--collapse) {
      width: 100%;
    }

    .el-menu-item {
      &:hover {
        background-color: #263445 !important;
      }

      &.is-active {
        background-color: #263445 !important;
        border-right: 3px solid #409eff;
      }
    }

    .el-sub-menu {
      .el-menu {
        background-color: #1f2d3d !important;
      }

      .el-menu-item {
        padding-left: 50px !important;
        min-width: auto;
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
</style>
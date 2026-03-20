/**
 * Vue Router Configuration
 */

import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/projects'
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('../views/ProjectsView.vue'),
    meta: { title: '项目管理' }
  },
  {
    path: '/projects/:id',
    name: 'ProjectDetail',
    component: () => import('../views/ProjectDetailView.vue'),
    meta: { title: '项目详情' }
  },
  {
    path: '/deployments',
    name: 'Deployments',
    component: () => import('../views/DeploymentsView.vue'),
    meta: { title: '部署队列' }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { title: '设置' }
  },
  {
    path: '/settings/connections',
    name: 'GitLabConnections',
    component: () => import('../views/GitLabConnectionsView.vue'),
    meta: { title: 'GitLab 连接' }
  },
  {
    path: '/settings/servers',
    name: 'Servers',
    component: () => import('../views/ServersView.vue'),
    meta: { title: '服务器管理' }
  },
  {
    path: '/logs',
    name: 'Logs',
    component: () => import('../views/LogsView.vue'),
    meta: { title: '系统日志' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// Update window title on navigation
router.beforeEach((to) => {
  const title = to.meta.title as string | undefined
  if (title) {
    document.title = `${title} - GitLab Auto Deploy`
  }
})

export default router

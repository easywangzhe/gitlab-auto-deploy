import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import './styles/global.scss'
import { setupIPCListeners, cleanupIPCListeners, initializeStores } from './ipc-setup'

const app = createApp(App)
const pinia = createPinia()

// 注册所有 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus)

app.mount('#app')

// Initialize IPC listeners after Pinia is ready
setupIPCListeners()

// Load initial data from main process
initializeStores().catch(console.error)

// Initialize theme
import('./composables/useTheme').then(({ useTheme }) => {
  // Theme will be initialized by the composable
})

// Cleanup on app unload (for HMR during development)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupIPCListeners()
  })
}
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings'

type Theme = 'light' | 'dark' | 'auto'

const systemDark = ref(false)
const currentTheme = ref<Theme>('auto')

// 获取系统主题偏好
const getSystemTheme = (): boolean => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// 应用主题
const applyTheme = (isDark: boolean) => {
  const html = document.documentElement

  if (isDark) {
    html.classList.add('dark')
  } else {
    html.classList.remove('dark')
  }
}

// 监听系统主题变化
let mediaQuery: MediaQueryList | null = null
const handleSystemThemeChange = (e: MediaQueryListEvent) => {
  systemDark.value = e.matches

  if (currentTheme.value === 'auto') {
    applyTheme(systemDark.value)
  }
}

// 初始化主题
export function useTheme() {
  const settingsStore = useSettingsStore()

  const initTheme = async () => {
    // 获取设置中的主题
    await settingsStore.loadSettings()
    currentTheme.value = settingsStore.settings?.theme || 'auto'

    // 获取系统主题
    systemDark.value = getSystemTheme()

    // 应用主题
    updateTheme()

    // 监听系统主题变化
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }

  // 更新主题
  const updateTheme = () => {
    let isDark = false

    if (currentTheme.value === 'dark') {
      isDark = true
    } else if (currentTheme.value === 'auto') {
      isDark = systemDark.value
    }

    applyTheme(isDark)
  }

  // 设置主题
  const setTheme = (theme: Theme) => {
    currentTheme.value = theme
    updateTheme()
  }

  // 监听主题设置变化
  watch(currentTheme, () => {
    updateTheme()
  })

  onMounted(() => {
    initTheme()
  })

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  })

  return {
    theme: currentTheme,
    systemDark,
    setTheme
  }
}
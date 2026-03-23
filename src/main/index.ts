import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupLogger } from './utils/logger'
import { registerIPCHandlers, setupDeploymentCallbacks, getSettings } from './services/IPCHandlers'
import { daemonService } from './services/DaemonService'
import { writeStatusFile, cleanupStatusFile } from './services/StatusFile'

// Initialize logger
const logger = setupLogger()

// Headless mode flag
let isHeadless = false
let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

// Check for headless CLI flag
function checkHeadlessMode(): boolean {
  const args = process.argv.slice(1)
  return args.includes('--headless') || args.includes('-h') || args.includes('--daemon')
}

// Create system tray icon
function createTrayIcon(): nativeImage {
  // Create a simple 16x16 icon for the tray
  // In production, you'd use a proper icon file
  const iconPath = join(__dirname, '../../resources/icon.png')
  try {
    return nativeImage.createFromPath(iconPath)
  } catch {
    // Fallback to empty image if icon not found
    return nativeImage.createEmpty()
  }
}

// Setup system tray for headless mode
function setupSystemTray(): void {
  if (tray) return

  const icon = createTrayIcon()
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    {
      label: 'Daemon Status',
      click: () => {
        const state = daemonService.getState()
        logger.info('Daemon status:', state)
      }
    },
    { type: 'separator' },
    {
      label: 'Start Daemon',
      click: async () => {
        try {
          await daemonService.start()
          updateTrayMenu()
        } catch (error) {
          logger.error('Failed to start daemon:', error)
        }
      }
    },
    {
      label: 'Stop Daemon',
      click: async () => {
        try {
          await daemonService.stop()
          updateTrayMenu()
        } catch (error) {
          logger.error('Failed to stop daemon:', error)
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('GitLab Auto Deploy')
  tray.setContextMenu(contextMenu)

  // Double-click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
}

// Update tray menu based on daemon state
function updateTrayMenu(): void {
  if (!tray) return

  const state = daemonService.getState()
  const statusText = state.status === 'running' ? 'Running' : 'Stopped'
  tray.setToolTip(`GitLab Auto Deploy - ${statusText}`)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    {
      label: `Daemon: ${statusText}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Start Daemon',
      enabled: state.status !== 'running',
      click: async () => {
        try {
          await daemonService.start()
          updateTrayMenu()
        } catch (error) {
          logger.error('Failed to start daemon:', error)
        }
      }
    },
    {
      label: 'Stop Daemon',
      enabled: state.status === 'running',
      click: async () => {
        try {
          await daemonService.stop()
          updateTrayMenu()
        } catch (error) {
          logger.error('Failed to stop daemon:', error)
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

// Graceful shutdown handler
async function handleShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  try {
    // Stop daemon if running
    const state = daemonService.getState()
    if (state.status === 'running') {
      logger.info('Stopping daemon...')
      await daemonService.stop()
    }

    // Clean up status file
    cleanupStatusFile()

    logger.info('Graceful shutdown complete')
  } catch (error) {
    logger.error('Error during shutdown:', error)
  }

  // Exit the process
  process.exit(0)
}

// Register shutdown handlers
function registerShutdownHandlers(): void {
  process.on('SIGTERM', () => handleShutdown('SIGTERM'))
  process.on('SIGINT', () => handleShutdown('SIGINT'))

  // Handle before-quit for Electron
  app.on('before-quit', async (event) => {
    event.preventDefault()
    await handleShutdown('app-quit')
  })
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Set Content Security Policy to allow data URIs for images
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
        ]
      }
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.gitlab.autodeploy')

  // Check for headless mode
  isHeadless = checkHeadlessMode()

  // Initialize IPC handlers and deployment callbacks BEFORE creating window
  // This ensures data is loaded when the frontend calls getSettings()
  await registerIPCHandlers()
  setupDeploymentCallbacks()

  // Register shutdown handlers for systemd compatibility
  registerShutdownHandlers()

  if (isHeadless) {
    // Hide dock icon on macOS
    if (process.platform === 'darwin') {
      app.dock.hide()
    }

    // Setup system tray for daemon control
    setupSystemTray()
  } else {
    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // IPC test
    ipcMain.on('ping', () => {
      logger.info('Received ping from renderer')
    })

    createWindow()
  }

  // Auto-start daemon if enabled in settings or in headless mode
  const settings = getSettings()
  if (isHeadless || settings?.daemon?.enabled) {
    daemonService.start().catch((error) => {
      logger.error('Failed to auto-start daemon:', error)
    })
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // Skip in headless mode
    if (!isHeadless && BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

logger.info('Application started')
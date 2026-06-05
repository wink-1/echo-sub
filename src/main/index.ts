import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startPythonBackend, stopPythonBackend } from './python-bridge'
import { createSubtitleWindow } from './subtitle-window'
import { startAudioCapture, stopAudioCapture } from './audio-capture'
import { registerIpcHandlers } from './ipc-handlers'
import { AppSettings, IPC_CHANNELS } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let subtitleWindow: BrowserWindow | null = null

const defaultSettings: AppSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 24,
  showBilingual: true,
  asrModel: 'large-v3-turbo',
  translationModel: 'qwen2.5:7b',
  windowOpacity: 0.85
}

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

app.whenReady().then(async () => {
  // 启动 Python 后端
  await startPythonBackend()

  // 创建主窗口
  createMainWindow()

  // 创建字幕悬浮窗
  subtitleWindow = createSubtitleWindow()

  // 注册 IPC 处理器
  registerIpcHandlers(defaultSettings, subtitleWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopAudioCapture()
  stopPythonBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAudioCapture()
  stopPythonBackend()
})

export { mainWindow, subtitleWindow, defaultSettings }

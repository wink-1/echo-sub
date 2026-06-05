import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startPythonBackend, stopPythonBackend } from './python-bridge'
import { createSubtitleWindow } from './subtitle-window'
import { startAudioCapture, stopAudioCapture, registerAudioIpcHandlers } from './audio-capture'
import { registerIpcHandlers } from './ipc-handlers'
import { AppSettings } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let subtitleWindow: BrowserWindow | null = null

const defaultSettings: AppSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 24,
  showBilingual: true,
  asrModel: 'base',
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
  // 初始化 electron-audio-loopback (注册 IPC handler)
  try {
    const { initMain } = await import('electron-audio-loopback')
    initMain()
    console.log('electron-audio-loopback initialized')
  } catch (err) {
    console.warn('Failed to initialize electron-audio-loopback:', err)
    console.warn('System audio capture will not be available')
  }

  // 注册音频 PCM 数据转发 IPC
  registerAudioIpcHandlers()

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

import {
  app,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  session,
  systemPreferences,
  Tray
} from 'electron'
import { join } from 'path'
import { startPythonBackend, stopPythonBackend } from './python-bridge'
import { createSubtitleWindow, closeSubtitleWindow, getSubtitleWindow } from './subtitle-window'
import { startAudioCapture, stopAudioCapture, registerAudioIpcHandlers } from './audio-capture'
import { registerIpcHandlers } from './ipc-handlers'
import { AppSettings } from '../shared/types'

let tray: Tray | null = null

const defaultSettings: AppSettings = Object.freeze({
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 24,
  showBilingual: true,
  windowOpacity: 0.85
})

function registerDisplayMediaHandler(): void {
  if (process.platform !== 'win32') return

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      })
      const screenSource = sources[0]

      if (!screenSource) {
        console.warn('Display media request denied: no screen sources found')
        callback({})
        return
      }

      console.log('Display media source selected:', screenSource.id, screenSource.name)
      callback({ video: screenSource, audio: 'loopback' })
    } catch (error) {
      console.error('Failed to resolve display media source:', error)
      callback({})
    }
  })
}

function createTrayIcon(): Electron.NativeImage {
  // 程序化创建 16x16 托盘图标（FM 电台波形图案）
  const size = 16
  const buffer = Buffer.alloc(size * size * 4, 0) // RGBA
  // 画两条竖条（简易声波图标）
  for (let y = 3; y <= 12; y++) {
    // 左竖条
    for (let x = 4; x <= 5; x++) {
      const i = (y * size + x) * 4
      buffer[i] = 255; buffer[i + 3] = 220  // 白色半透明
    }
    // 中竖条
    for (let x = 7; x <= 8; x++) {
      const i = (y * size + x) * 4
      buffer[i] = 255; buffer[i + 3] = 220
    }
    // 右竖条（稍短）
    if (y >= 5 && y <= 10) {
      for (let x = 10; x <= 11; x++) {
        const i = (y * size + x) * 4
        buffer[i] = 255; buffer[i + 3] = 220
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buffer, { width: size, height: size })
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }
  return icon
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('EchoSub - AI同声传译助手')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏字幕窗口',
      click: () => {
        const win = getSubtitleWindow()
        if (win && !win.isDestroyed()) {
          if (win.isVisible()) {
            win.hide()
          } else {
            win.show()
          }
        } else {
          createSubtitleWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出 EchoSub',
      click: () => {
        stopAudioCapture()
        stopPythonBackend()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    const win = getSubtitleWindow()
    if (win && !win.isDestroyed()) {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
      }
    }
  })
}

// 全局异常处理：记录未捕获错误，避免静默崩溃
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
})

app.whenReady().then(async () => {
  registerDisplayMediaHandler()

  // 注册音频 PCM 数据转发 IPC
  registerAudioIpcHandlers()

  // 启动 Python 后端
  await startPythonBackend()

  // 只创建字幕悬浮窗
  const subtitleWindow = createSubtitleWindow()

  // 注册 IPC 处理器（仅一次）
  registerIpcHandlers(defaultSettings, subtitleWindow)

  // 系统托盘
  createTray()

  // 字幕悬浮窗控制
  ipcMain.handle('open-subtitle-window', () => {
    let win = getSubtitleWindow()
    if (!win || win.isDestroyed()) {
      win = createSubtitleWindow()
    }
    win.show()
    return { success: true }
  })

  ipcMain.handle('close-subtitle-window', () => {
    closeSubtitleWindow()
    return { success: true }
  })

  ipcMain.handle('is-subtitle-window-open', () => {
    const win = getSubtitleWindow()
    return win !== null && !win.isDestroyed()
  })

  // 始终置顶切换
  ipcMain.handle('toggle-always-on-top', () => {
    const win = getSubtitleWindow()
    if (win && !win.isDestroyed()) {
      const current = win.isAlwaysOnTop()
      win.setAlwaysOnTop(!current)
      return { alwaysOnTop: !current }
    }
    return { alwaysOnTop: false }
  })

  // macOS: 检查屏幕录制权限状态
  ipcMain.handle('check-screen-record-permission', () => {
    if (process.platform !== 'darwin') return { granted: true, platform: process.platform }
    try {
      const status = systemPreferences.getMediaAccessStatus('screen')
      return { granted: status === 'granted', status, platform: process.platform }
    } catch {
      return { granted: false, status: 'unknown', platform: process.platform }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAudioCapture()
    stopPythonBackend()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAudioCapture()
  stopPythonBackend()
})

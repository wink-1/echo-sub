import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { startPythonBackend, stopPythonBackend } from './python-bridge'
import { createSubtitleWindow, closeSubtitleWindow, getSubtitleWindow } from './subtitle-window'
import { startAudioCapture, stopAudioCapture, registerAudioIpcHandlers } from './audio-capture'
import { registerIpcHandlers } from './ipc-handlers'
import { AppSettings } from '../shared/types'

let subtitleWindow: BrowserWindow | null = null
let tray: Tray | null = null

const defaultSettings: AppSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 24,
  showBilingual: true,
  windowOpacity: 0.85
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
        if (subtitleWindow && !subtitleWindow.isDestroyed()) {
          if (subtitleWindow.isVisible()) {
            subtitleWindow.hide()
          } else {
            subtitleWindow.show()
          }
        } else {
          subtitleWindow = createSubtitleWindow()
          registerIpcHandlers(defaultSettings, subtitleWindow)
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
    if (subtitleWindow && !subtitleWindow.isDestroyed()) {
      if (subtitleWindow.isVisible()) {
        subtitleWindow.hide()
      } else {
        subtitleWindow.show()
      }
    }
  })
}

app.whenReady().then(async () => {
  // 注册音频 PCM 数据转发 IPC
  registerAudioIpcHandlers()

  // 启动 Python 后端
  await startPythonBackend()

  // 只创建字幕悬浮窗
  subtitleWindow = createSubtitleWindow()

  // 注册 IPC 处理器
  registerIpcHandlers(defaultSettings, subtitleWindow)

  // 系统托盘
  createTray()

  // 字幕悬浮窗控制
  ipcMain.handle('open-subtitle-window', () => {
    if (!subtitleWindow || subtitleWindow.isDestroyed()) {
      subtitleWindow = createSubtitleWindow()
    }
    subtitleWindow.show()
    return { success: true }
  })

  ipcMain.handle('close-subtitle-window', () => {
    closeSubtitleWindow()
    subtitleWindow = null
    return { success: true }
  })

  ipcMain.handle('is-subtitle-window-open', () => {
    return subtitleWindow !== null && !subtitleWindow.isDestroyed()
  })

  // 始终置顶切换
  ipcMain.handle('toggle-always-on-top', () => {
    if (subtitleWindow && !subtitleWindow.isDestroyed()) {
      const current = subtitleWindow.isAlwaysOnTop()
      subtitleWindow.setAlwaysOnTop(!current)
      return { alwaysOnTop: !current }
    }
    return { alwaysOnTop: false }
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

export { subtitleWindow, defaultSettings }

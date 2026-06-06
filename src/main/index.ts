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

function createTray(): void {
  // 创建 16x16 简易托盘图标
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEYSURBVDiNpZMxTsNAEEX/rNeOAwUlHVdA4gJcAokLUFBQcAQkLkCBhMQFkJAoKOAIFICElJQp3PAMK97dJXgULDl2PFL8abTz/8zO7Cql8B8T4Bk4AY7LGg3gEXgAHoF1KQC4BG6b2EONq8CkBHhs8ufAcSOB0yZfC9gB3oBX4LZI4A74AF6A2yKBe+ATeAbuigQegC/gGbiPBVbAd5kAizmgHQs8AT/AJ/AUC6TZcA58AnNzrfkBcAOcg87+j1CbGcANcA7szwJSK84oI50RZ0ylmSFGMEaMMWKM3Asm32qBbM0fHtN5xnAiDQCbgwJfyMRx2SC8b+bQBmRGJB3MnAPoLmY/G0OnBq9g/X1BZP8FrNY/M/QBdSQlxtX9n4AAAAASUVORK5CYII='
  )
  tray = new Tray(icon)
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

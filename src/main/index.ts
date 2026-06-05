import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startPythonBackend, stopPythonBackend } from './python-bridge'
import { createSubtitleWindow, closeSubtitleWindow, getSubtitleWindow } from './subtitle-window'
import { startAudioCapture, stopAudioCapture, registerAudioIpcHandlers } from './audio-capture'
import { registerIpcHandlers } from './ipc-handlers'
import { AppSettings } from '../shared/types'

let subtitleWindow: BrowserWindow | null = null

const defaultSettings: AppSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  fontSize: 24,
  showBilingual: true,
  windowOpacity: 0.85
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

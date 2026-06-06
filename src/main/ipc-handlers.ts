// IPC 处理器 - 主进程与渲染进程通信

import { ipcMain, BrowserWindow } from 'electron'
import { AppSettings, IPC_CHANNELS, BackendMessage } from '../shared/types'
import { startAudioCapture, stopAudioCapture } from './audio-capture'
import { onBackendMessage, sendToBackend } from './python-bridge'

let currentSettings: AppSettings

export function registerIpcHandlers(
  settings: AppSettings,
  subtitleWindow: BrowserWindow | null
): void {
  currentSettings = settings

  // 设置后端消息回调
  onBackendMessage((msg: BackendMessage) => {
    handleBackendMessage(msg)
  })

  // 开始捕获
  ipcMain.handle(IPC_CHANNELS.START_CAPTURE, async () => {
    sendToBackend({ type: 'start', data: {} })
    const success = await startAudioCapture()
    return { success }
  })

  // 停止捕获
  ipcMain.handle(IPC_CHANNELS.STOP_CAPTURE, async () => {
    stopAudioCapture()
    sendToBackend({ type: 'stop', data: {} })
    return { success: true }
  })

  // 更新设置 (保留接口兼容性)
  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_event, newSettings: Partial<AppSettings>) => {
    currentSettings = { ...currentSettings, ...newSettings }
    sendToBackend({
      type: 'set_language',
      data: { language: currentSettings.sourceLanguage }
    })
    return currentSettings
  })

  // 获取设置
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return currentSettings
  })
}

/**
 * 广播消息到所有窗口
 */
function broadcastToWindows(msg: BackendMessage): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.TRANSLATION_UPDATE, msg)
    }
  }
}

/**
 * 处理来自 Python 后端的消息
 */
function handleBackendMessage(msg: BackendMessage): void {
  switch (msg.type) {
    case 'asr_partial':
    case 'asr_final':
    case 'translation_partial':
    case 'translation_final':
    case 'correction':
      broadcastToWindows(msg)
      break

    case 'status':
      console.log('Backend status:', msg.data.message)
      break

    case 'error':
      console.error('Backend error:', msg.data.message)
      break
  }
}

// IPC 处理器 - 主进程与渲染进程通信

import { ipcMain, BrowserWindow } from 'electron'
import { AppSettings, IPC_CHANNELS, BackendMessage } from '../shared/types'
import { startAudioCapture, stopAudioCapture } from './audio-capture'
import { onBackendMessage, sendToBackend } from './python-bridge'
import { updateSubtitleContent } from './subtitle-window'

let currentSettings: AppSettings

export function registerIpcHandlers(
  settings: AppSettings,
  subtitleWindow: BrowserWindow | null
): void {
  currentSettings = settings

  // 设置后端消息回调
  onBackendMessage((msg: BackendMessage) => {
    handleBackendMessage(msg, subtitleWindow)
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

  // 更新设置
  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_event, newSettings: Partial<AppSettings>) => {
    currentSettings = { ...currentSettings, ...newSettings }
    sendToBackend({
      type: 'set_language',
      data: {
        language: currentSettings.sourceLanguage
      }
    })
    return currentSettings
  })

  // 获取设置
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return currentSettings
  })
}

/**
 * 广播消息到所有窗口 (主窗口 + 字幕窗口)
 */
function broadcastToWindows(msg: BackendMessage): void {
  const { BrowserWindow } = require('electron')
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
function handleBackendMessage(msg: BackendMessage, subtitleWindow: BrowserWindow | null): void {
  switch (msg.type) {
    case 'asr_partial':
    case 'asr_final':
      // ASR 识别结果 - 广播到所有窗口
      broadcastToWindows(msg)
      break

    case 'translation_partial':
      // 流式翻译 - 半透明显示 + 广播到主窗口
      updateSubtitleContent(msg.data.text, msg.data.originalText || '', 'partial')
      broadcastToWindows(msg)
      break

    case 'translation_final':
      // 确认翻译 - 实心显示 + 广播到主窗口
      updateSubtitleContent(msg.data.text, msg.data.originalText || '', 'confirmed')
      broadcastToWindows(msg)
      break

    case 'correction':
      // 纠错 - 高亮显示 + 广播到主窗口
      updateSubtitleContent(msg.data.correctedText || msg.data.text, msg.data.originalText || '', 'corrected')
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

// 音频捕获模块 - 主进程接收渲染进程发来的 PCM 音频数据, 转发给 Python 后端

import { ipcMain } from 'electron'
import type { WebSocket } from 'ws'

let isCapturing = false
let wsConnection: WebSocket | null = null

/**
 * 设置 WebSocket 连接引用, 用于发送音频数据
 */
export function setWebSocketConnection(ws: WebSocket): void {
  wsConnection = ws
}

/**
 * 开始捕获标记 (实际音频捕获在渲染进程通过 getUserMedia 完成)
 */
export async function startAudioCapture(): Promise<boolean> {
  if (isCapturing) return true

  isCapturing = true
  console.log('Audio capture started (renderer-driven)')
  return true
}

/**
 * 停止捕获标记
 */
export function stopAudioCapture(): void {
  isCapturing = false
  console.log('Audio capture stopped')
}

/**
 * 获取当前捕获状态
 */
export function isAudioCapturing(): boolean {
  return isCapturing
}

/**
 * 注册 IPC handler: 接收渲染进程发来的 PCM 音频数据, 转发给 Python 后端
 */
export function registerAudioIpcHandlers(): void {
  ipcMain.on('audio-pcm-data', (_event, data: Buffer) => {
    if (wsConnection && wsConnection.readyState === 1) { // WebSocket.OPEN = 1
      wsConnection.send(data)
    }
  })

  ipcMain.handle('is-audio-capturing', () => {
    return isCapturing
  })
}

// 音频捕获模块 - 主进程接收渲染进程发来的 PCM 音频数据, 转发给 Python 后端

import { ipcMain } from 'electron'
import type { WebSocket } from 'ws'

let isCapturing = false
let wsConnection: WebSocket | null = null

// 统计发送的音频包
let packetsSent = 0
let lastLogTime = 0

/**
 * 设置 WebSocket 连接引用, 用于发送音频数据
 */
export function setWebSocketConnection(ws: WebSocket): void {
  wsConnection = ws
  packetsSent = 0
  console.log('Audio capture: WebSocket connection set')
}

/**
 * 开始捕获标记 (实际音频捕获在渲染进程通过 getUserMedia 完成)
 */
export async function startAudioCapture(): Promise<boolean> {
  if (isCapturing) return true

  isCapturing = true
  packetsSent = 0
  console.log('Audio capture started (renderer-driven)')
  return true
}

/**
 * 停止捕获标记
 */
export function stopAudioCapture(): void {
  isCapturing = false
  console.log(`Audio capture stopped (sent ${packetsSent} packets total)`)
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
  ipcMain.on('audio-pcm-data', (_event, data: ArrayBuffer) => {
    if (!isCapturing) {
      // console.log('Audio IPC: not capturing, dropping packet')
      return
    }

    if (!wsConnection) {
      console.log('Audio IPC: WebSocket not connected, dropping packet')
      return
    }

    if (wsConnection.readyState !== 1) { // WebSocket.OPEN = 1
      console.log(`Audio IPC: WebSocket not open (state=${wsConnection.readyState}), dropping packet`)
      return
    }

    try {
      // data 从渲染进程传过来是 ArrayBuffer
      const buffer = Buffer.from(data)
      wsConnection.send(buffer)
      packetsSent++

      // 每 5 秒输出一次统计
      const now = Date.now()
      if (now - lastLogTime > 5000) {
        console.log(`Audio: ${packetsSent} packets sent to backend (${buffer.length} bytes/packet)`)
        lastLogTime = now
      }
    } catch (err) {
      console.error('Failed to send audio data to backend:', err)
    }
  })

  ipcMain.handle('is-audio-capturing', () => {
    return isCapturing
  })
}

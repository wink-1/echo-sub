// 音频捕获模块 - 使用 electron-audio-loopback 捕获系统音频
// API 说明:
//   主进程: initMain() 注册 IPC handler
//   渲染进程: getLoopbackAudioMediaStream() 获取 MediaStream
//   音频流通过 AudioWorklet → PCM 数据 → WebSocket 发送到 Python 后端

import { ipcMain } from 'electron'
import type { WebSocket } from 'ws'

let isCapturing = false
let wsConnection: WebSocket | null = null

const AUDIO_CONFIG = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  chunkDurationMs: 200 // 200ms 一帧
}

/**
 * 设置 WebSocket 连接引用,用于发送音频数据
 */
export function setWebSocketConnection(ws: WebSocket): void {
  wsConnection = ws
}

/**
 * 开始捕获系统音频
 * 注意: 实际音频捕获在渲染进程通过 getLoopbackAudioMediaStream() 完成
 * 主进程负责接收 PCM 数据并通过 WebSocket 转发给 Python 后端
 */
export async function startAudioCapture(): Promise<boolean> {
  if (isCapturing) return true

  isCapturing = true
  console.log('Audio capture started (renderer-driven)')
  return true
}

/**
 * 停止捕获系统音频
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
 * 注册 IPC handler: 接收渲染进程发来的 PCM 音频数据,转发给 Python 后端
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

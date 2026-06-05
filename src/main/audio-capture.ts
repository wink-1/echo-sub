// 音频捕获模块 - 使用 electron-audio-loopback 捕获系统音频
// 注意: electron-audio-loopback 是 native 模块,需要正确安装

/// <reference types="ws" />

import { ipcMain } from 'electron'
import type { WebSocket } from 'ws'

let isCapturing = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loopbackStream: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wsConnection: any = null

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
 */
export async function startAudioCapture(): Promise<boolean> {
  if (isCapturing) return true

  try {
    // 动态导入 native 模块
    const { createLoopback } = await import('electron-audio-loopback')

    loopbackStream = await createLoopback({
      sampleRate: AUDIO_CONFIG.sampleRate,
      channels: AUDIO_CONFIG.channels,
      bitDepth: AUDIO_CONFIG.bitDepth
    })

    loopbackStream.on('data', (chunk: Buffer) => {
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(chunk)
      }
    })

    loopbackStream.on('error', (err: Error) => {
      console.error('Audio capture error:', err)
      stopAudioCapture()
    })

    isCapturing = true
    console.log('Audio capture started')
    return true
  } catch (error) {
    console.error('Failed to start audio capture:', error)
    // 降级: 使用麦克风输入
    console.log('Falling back to microphone input...')
    return false
  }
}

/**
 * 停止捕获系统音频
 */
export function stopAudioCapture(): void {
  if (loopbackStream) {
    loopbackStream.destroy()
    loopbackStream = null
  }
  isCapturing = false
  console.log('Audio capture stopped')
}

/**
 * 获取当前捕获状态
 */
export function isAudioCapturing(): boolean {
  return isCapturing
}

// Python 子进程桥接 - 启动和管理 Python 后端进程

import { spawn, ChildProcess } from 'child_process'
import { WebSocket } from 'ws'
import { app } from 'electron'
import { join } from 'path'
import { BackendMessage } from '../shared/types'
import { setWebSocketConnection } from './audio-capture'

let pythonProcess: ChildProcess | null = null
let wsClient: WebSocket | null = null
const BACKEND_PORT = 8765
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let messageCallback: ((msg: BackendMessage) => void) | null = null

/**
 * 设置消息回调,用于将后端消息转发给渲染进程
 */
export function onBackendMessage(callback: (msg: BackendMessage) => void): void {
  messageCallback = callback
}

/**
 * 启动 Python 后端进程并建立 WebSocket 连接
 */
export async function startPythonBackend(): Promise<void> {
  const backendDir = join(__dirname, '../../backend')
  const pythonPath = findPython()

  console.log('Starting Python backend with:', pythonPath)

  pythonProcess = spawn(pythonPath, [join(backendDir, 'server.py')], {
    cwd: backendDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      HF_ENDPOINT: 'https://hf-mirror.com',
      PYTHONUNBUFFERED: '1',  // Python 日志实时输出,不缓冲
      // 清除代理设置，避免本地代理拦截 HuggingFace 镜像连接
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: ''
    }
  })

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Python] ${data.toString().trim()}`)
  })

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Python Error] ${data.toString().trim()}`)
  })

  pythonProcess.on('exit', (code) => {
    console.log(`Python backend exited with code ${code}`)
    pythonProcess = null
  })

  // 等待后端启动后连接 WebSocket
  await connectWebSocket()
}

/**
 * 连接到 Python 后端 WebSocket
 */
async function connectWebSocket(): Promise<void> {
  const maxRetries = 10
  const retryDelay = 1000

  for (let i = 0; i < maxRetries; i++) {
    try {
      wsClient = new WebSocket(WS_URL)

      await new Promise<void>((resolve, reject) => {
        wsClient!.on('open', () => {
          console.log('Connected to Python backend via WebSocket')
          setWebSocketConnection(wsClient!)
          resolve()
        })

        wsClient!.on('error', (err) => {
          reject(err)
        })
      })

      wsClient.on('message', (data: Buffer) => {
        try {
          const msg: BackendMessage = JSON.parse(data.toString())
          messageCallback?.(msg)
        } catch (e) {
          console.error('Failed to parse backend message:', e)
        }
      })

      wsClient.on('close', () => {
        console.log('WebSocket connection closed')
        wsClient = null
      })

      return
    } catch {
      console.log(`WebSocket connection attempt ${i + 1}/${maxRetries} failed, retrying...`)
      await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }
  }

  console.error('Failed to connect to Python backend after retries')
}

/**
 * 停止 Python 后端
 */
export function stopPythonBackend(): void {
  if (wsClient) {
    wsClient.close()
    wsClient = null
  }

  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
  }
}

/**
 * 发送消息到 Python 后端
 */
export function sendToBackend(message: Record<string, unknown>): void {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify(message))
  }
}

/**
 * 查找可用的 Python 可执行文件
 * 优先使用 backend/venv/bin/python3 (用户安装的依赖都在这里面)
 */
function findPython(): string {
  const backendDir = join(__dirname, '../../backend')
  const venvPython = join(backendDir, 'venv/bin/python3')

  // 检查 venv 是否存在
  try {
    const fs = require('fs')
    if (fs.existsSync(venvPython)) {
      console.log('Using venv Python:', venvPython)
      return venvPython
    }
  } catch {
    // 忽略错误
  }

  // 降级到系统 python3
  console.log('Using system Python: python3')
  return 'python3'
}

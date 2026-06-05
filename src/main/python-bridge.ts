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
const WS_URL = `ws://localhost:${BACKEND_PORT}`

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
    env: { ...process.env, PORT: String(BACKEND_PORT) }
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
 */
function findPython(): string {
  const candidates = ['python3', 'python']
  // 优先使用 managed Python
  const managedPython = '/Users/wink/.workbuddy/binaries/python/envs/default/bin/python3'
  return managedPython
}

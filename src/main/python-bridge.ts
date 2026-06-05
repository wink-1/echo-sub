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
 * 先自动下载模型（如果未缓存），再启动服务器
 */
export async function startPythonBackend(): Promise<void> {
  const backendDir = getBackendDir()
  const pythonPath = findPython()

  // 从 .env 文件读取环境变量
  const envOverrides = loadEnvFile(backendDir)

  console.log(`Backend dir: ${backendDir}`)
  console.log(`Python path: ${pythonPath}`)

  // Step 1: 预下载 ASR 模型（如果已缓存则秒过）
  console.log('Downloading ASR model (if not cached)...')
  await downloadModelIfNeeded(pythonPath, backendDir, envOverrides)

  // Step 2: 启动 Python 后端
  console.log('Starting Python backend...')

  pythonProcess = spawn(pythonPath, [join(backendDir, 'server.py')], {
    cwd: backendDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...envOverrides,
      PORT: String(BACKEND_PORT),
      HF_ENDPOINT: 'https://hf-mirror.com',
      PYTHONUNBUFFERED: '1',
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
    console.log(`[Python] ${data.toString().trim()}`)
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
  // 模型已预下载到缓存，但加载仍可能需要一些时间
  const maxRetries = 30
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
        console.log('WebSocket connection closed, attempting reconnect...')
        wsClient = null
        // 自动重连
        setTimeout(() => {
          if (pythonProcess && !wsClient) {
            console.log('[WS] Reconnecting to Python backend...')
            connectWebSocket().catch(err => {
              console.error('[WS] Reconnect failed:', err)
            })
          }
        }, 2000)
      })

      return
    } catch {
      if (i % 5 === 0) {
        console.log(`WebSocket connection attempt ${i + 1}/${maxRetries}, waiting for Python backend...`)
      }
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
 * 预下载 ASR 模型到本地缓存（如果已缓存则立即返回）
 */
async function downloadModelIfNeeded(
  pythonPath: string,
  backendDir: string,
  envOverrides: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [join(backendDir, 'download_model.py')], {
      cwd: backendDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...envOverrides,
        HF_ENDPOINT: 'https://hf-mirror.com',
        PYTHONUNBUFFERED: '1',
        http_proxy: '',
        https_proxy: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: ''
      }
    })

    child.stdout.on('data', (data: Buffer) => {
      console.log(`[Download] ${data.toString().trim()}`)
    })

    child.stderr.on('data', (data: Buffer) => {
      console.log(`[Download] ${data.toString().trim()}`)
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Model download failed with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
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
 * 获取后端目录路径 (dev 模式 vs 打包模式)
 */
function getBackendDir(): string {
  // 打包模式: extraResources 将 backend/ 放到 Contents/Resources/backend/
  if (app.isPackaged) {
    const resourcePath = process.resourcesPath || join(app.getAppPath(), '..', 'Resources')
    return join(resourcePath, 'backend')
  }
  // 开发模式: 相对于 out/main/ 的 ../../backend/
  return join(__dirname, '../../backend')
}

/**
 * 查找可用的 Python 可执行文件
 * 优先使用 backend/venv/bin/python3 (dev 模式)
 */
function findPython(): string {
  const backendDir = getBackendDir()

  // 开发模式: 检查 venv
  if (!app.isPackaged) {
    const venvPython = join(backendDir, 'venv/bin/python3')
    try {
      const fs = require('fs')
      if (fs.existsSync(venvPython)) {
        console.log('Using venv Python:', venvPython)
        return venvPython
      }
    } catch { /* ignore */ }
  }

  // 系统 python3 (开发降级 或 打包模式)
  console.log('Using system Python: python3')
  return 'python3'
}

/**
 * 从 .env 文件读取环境变量
 * .env 文件在 .gitignore 中，不会被提交到 Git
 */
function loadEnvFile(backendDir: string): Record<string, string> {
  const envVars: Record<string, string> = {}
  const fs = require('fs')
  const path = require('path')

  // 查找 .env 文件：先找项目根目录，再找 backend 目录
  const rootDir = path.resolve(backendDir, '..')
  const envPaths = [
    path.join(rootDir, '.env'),
    path.join(backendDir, '.env'),
  ]

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      console.log(`[env] Loading: ${envPath}`)
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        // 跳过注释和空行
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = trimmed.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          let value = match[2].trim()
          // 去除引号
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          envVars[key] = value
        }
      }
      break  // 找到第一个 .env 就停止
    }
  }

  if (Object.keys(envVars).length > 0) {
    console.log(`[env] Loaded ${Object.keys(envVars).length} variables`)
  } else {
    console.warn('[env] No .env file found. Please create .env with DEEPSEEK_API_KEY')
  }

  return envVars
}

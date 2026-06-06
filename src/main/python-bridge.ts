// Python 子进程桥接 - 启动和管理 Python 后端进程

import { spawn, ChildProcess } from 'child_process'
import { WebSocket } from 'ws'
import { app } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { BackendMessage } from '../shared/types'
import { BACKEND_CONFIG } from '../shared/config'
import { setWebSocketConnection } from './audio-capture'

let pythonProcess: ChildProcess | null = null
let downloadProcess: ChildProcess | null = null
let wsClient: WebSocket | null = null
const BACKEND_PORT = BACKEND_CONFIG.PORT
const WS_URL = `ws://localhost:${BACKEND_PORT}/ws`

// WebSocket 重连控制
let wsReconnectCount = 0
const WS_MAX_RECONNECT = BACKEND_CONFIG.WS_MAX_RECONNECT
const WS_RECONNECT_DELAY = BACKEND_CONFIG.WS_RECONNECT_DELAY

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

  try {
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
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
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
  } catch (err) {
    // 连接失败时清理已启动的 Python 进程
    console.error('Failed to start Python backend:', err)
    if (pythonProcess) {
      pythonProcess.kill('SIGTERM')
      pythonProcess = null
    }
    throw err
  }
}

/**
 * 连接到 Python 后端 WebSocket
 */
async function connectWebSocket(): Promise<void> {
  // 模型已预下载到缓存，但加载仍可能需要一些时间
  const maxRetries = BACKEND_CONFIG.WS_MAX_RETRIES
  const retryDelay = 1000

  for (let i = 0; i < maxRetries; i++) {
    try {
      // 使用局部变量 ws，避免循环中覆盖模块级 wsClient 导致的并发问题
      const ws = new WebSocket(WS_URL)

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          console.log('Connected to Python backend via WebSocket')
          wsReconnectCount = 0
          // 在 open 回调内注册 message/close 事件，确保仅对已打开的连接生效
          ws.on('message', (data: Buffer) => {
            try {
              const msg: BackendMessage = JSON.parse(data.toString())
              messageCallback?.(msg)
            } catch (e) {
              console.error('Failed to parse backend message:', e)
            }
          })

          ws.on('close', () => {
            console.log('WebSocket connection closed')
            // 仅当 ws 仍是当前活跃连接时才清理
            if (wsClient === ws) {
              wsClient = null
            }
            // 自动重连（有限次数）
            if (pythonProcess && wsReconnectCount < WS_MAX_RECONNECT) {
              wsReconnectCount++
              console.log(`[WS] Reconnecting (attempt ${wsReconnectCount}/${WS_MAX_RECONNECT})...`)
              setTimeout(() => {
                connectWebSocket().catch((err: unknown) => {
                  console.error('[WS] Reconnect failed:', err)
                })
              }, WS_RECONNECT_DELAY)
            } else if (wsReconnectCount >= WS_MAX_RECONNECT) {
              console.error(`[WS] Max reconnect attempts (${WS_MAX_RECONNECT}) reached. Giving up.`)
            }
          })

          wsClient = ws
          setWebSocketConnection(ws)
          resolve()
        })

        ws.on('error', (err) => {
          reject(err)
        })
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

  if (downloadProcess) {
    downloadProcess.kill('SIGTERM')
    downloadProcess = null
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
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      }
    })

    downloadProcess = child

    child.stdout.on('data', (data: Buffer) => {
      console.log(`[Download] ${data.toString().trim()}`)
    })

    child.stderr.on('data', (data: Buffer) => {
      console.log(`[Download] ${data.toString().trim()}`)
    })

    child.on('exit', (code) => {
      downloadProcess = null
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Model download failed with code ${code}`))
      }
    })

    child.on('error', (err) => {
      downloadProcess = null
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
  const isWindows = process.platform === 'win32'

  // 开发模式: 优先用项目 venv
  if (!app.isPackaged) {
    const venvPaths = isWindows
      ? [join(backendDir, 'venv/Scripts/python.exe'), join(backendDir, 'venv/Scripts/python3.exe')]
      : [join(backendDir, 'venv/bin/python3'), join(backendDir, 'venv/bin/python')]
    for (const venvPython of venvPaths) {
      if (existsSync(venvPython)) {
        console.log('Using venv Python:', venvPython)
        return venvPython
      }
    }
  }

  // 系统 Python
  const systemPython = isWindows ? 'python' : 'python3'
  console.log('Using system Python:', systemPython)
  return systemPython
}

/**
 * 从 .env 文件读取环境变量
 * .env 文件在 .gitignore 中，不会被提交到 Git
 */
function loadEnvFile(backendDir: string): Record<string, string> {
  const envVars: Record<string, string> = {}

  // 查找 .env 文件：先找项目根目录，再找 backend 目录
  const rootDir = resolve(backendDir, '..')
  const envPaths = [
    join(rootDir, '.env'),
    join(backendDir, '.env'),
  ]

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log(`[env] Loading: ${envPath}`)
      const content = readFileSync(envPath, 'utf-8')
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

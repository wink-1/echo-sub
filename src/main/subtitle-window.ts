import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { app } from 'electron'

let subtitleWindow: BrowserWindow | null = null

interface WindowState {
  x?: number
  y?: number
  width?: number
  height?: number
}

function getStatePath(): string {
  const userData = app.getPath('userData')
  return join(userData, 'subtitle-window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const statePath = getStatePath()
    if (existsSync(statePath)) {
      const data = readFileSync(statePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.warn('Failed to load window state:', e)
  }
  return {}
}

function saveWindowState(): void {
  if (!subtitleWindow || subtitleWindow.isDestroyed()) return
  try {
    const [x, y] = subtitleWindow.getPosition()
    const [width, height] = subtitleWindow.getSize()
    const statePath = getStatePath()
    const dir = join(statePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(statePath, JSON.stringify({ x, y, width, height }))
  } catch (e) {
    console.warn('Failed to save window state:', e)
  }
}

export function createSubtitleWindow(): BrowserWindow {
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.close()
  }

  const state = loadWindowState()
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const winWidth = state.width || 900
  const winHeight = state.height || 340

  // 优先使用保存的位置，确保窗口在屏幕范围内
  let winX: number, winY: number
  if (state.x !== undefined && state.y !== undefined) {
    // 验证保存的位置仍在可用屏幕内
    const displays = screen.getAllDisplays()
    const isOnScreen = displays.some(d => {
      const { x: dx, y: dy, width: dw, height: dh } = d.workArea
      return state.x! >= dx - 100 && state.x! <= dx + dw - 100 &&
             state.y! >= dy - 50 && state.y! <= dy + dh - 50
    })
    if (isOnScreen) {
      winX = state.x
      winY = state.y
    } else {
      winX = Math.round((screenWidth - winWidth) / 2)
      winY = Math.round(screenHeight - winHeight - 40)
    }
  } else {
    winX = Math.round((screenWidth - winWidth) / 2)
    winY = Math.round(screenHeight - winHeight - 40)
  }

  subtitleWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 600,
    minHeight: 220,
    x: winX,
    y: winY,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  subtitleWindow.setOpacity(0.92)

  // 允许在所有工作区和全屏上显示
  subtitleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    subtitleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '#subtitle' })
  }

  subtitleWindow.on('closed', () => {
    saveWindowState()
    subtitleWindow = null
  })

  // 拖拽结束时保存位置
  subtitleWindow.on('moved', () => {
    saveWindowState()
  })

  subtitleWindow.on('resize', () => {
    saveWindowState()
  })

  // 拖拽 IPC
  ipcMain.removeHandler('subtitle-drag')
  ipcMain.handle('subtitle-drag', (_event, deltaX: number, deltaY: number) => {
    if (subtitleWindow && !subtitleWindow.isDestroyed()) {
      const [x, y] = subtitleWindow.getPosition()
      subtitleWindow.setPosition(x + deltaX, y + deltaY)
    }
  })

  return subtitleWindow
}

export function getSubtitleWindow(): BrowserWindow | null {
  return subtitleWindow
}

export function closeSubtitleWindow(): void {
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    saveWindowState()
    subtitleWindow.close()
    subtitleWindow = null
  }
}

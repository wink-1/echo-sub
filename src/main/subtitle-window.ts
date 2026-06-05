import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'

let subtitleWindow: BrowserWindow | null = null

export function createSubtitleWindow(): BrowserWindow {
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.close()
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const winWidth = 900
  const winHeight = 340

  subtitleWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 600,
    minHeight: 220,
    x: Math.round((screenWidth - winWidth) / 2),
    y: Math.round(screenHeight - winHeight - 40),
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
    subtitleWindow = null
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

export function updateSubtitleContent(text: string, sourceText: string, status: string): void {
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.webContents.send('subtitle-update', {
      text,
      sourceText,
      status
    })
  }
}

export function getSubtitleWindow(): BrowserWindow | null {
  return subtitleWindow
}

export function closeSubtitleWindow(): void {
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.close()
    subtitleWindow = null
  }
}

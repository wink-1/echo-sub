import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

let subtitleWindow: BrowserWindow | null = null

export function createSubtitleWindow(): BrowserWindow {
  // 如果窗口已存在，先关闭
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.close()
  }

  subtitleWindow = new BrowserWindow({
    width: 900,
    height: 140,
    x: 200,
    y: 100,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 设置窗口透明度 (macOS)
  subtitleWindow.setOpacity(0.95)

  if (process.env.ELECTRON_RENDERER_URL) {
    subtitleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '#subtitle' })
  }

  subtitleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 处理窗口关闭
  subtitleWindow.on('closed', () => {
    subtitleWindow = null
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

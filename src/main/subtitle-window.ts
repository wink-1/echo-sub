import { BrowserWindow } from 'electron'
import { join } from 'path'

let subtitleWindow: BrowserWindow | null = null

export function createSubtitleWindow(): BrowserWindow {
  subtitleWindow = new BrowserWindow({
    width: 800,
    height: 120,
    x: 100,
    y: 50,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    subtitleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '#subtitle' })
  }

  subtitleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

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

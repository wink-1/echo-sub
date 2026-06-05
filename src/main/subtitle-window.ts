import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'

let subtitleWindow: BrowserWindow | null = null

export function createSubtitleWindow(): BrowserWindow {
  // 如果窗口已存在，先关闭
  if (subtitleWindow && !subtitleWindow.isDestroyed()) {
    subtitleWindow.close()
  }

  // 获取屏幕尺寸，默认放在底部居中
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const winWidth = 800
  const winHeight = 160

  subtitleWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round((screenWidth - winWidth) / 2),
    y: Math.round(screenHeight - winHeight - 80),
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

  // 允许在所有工作区和全屏上显示
  subtitleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    subtitleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '#subtitle' })
  }

  // 处理窗口关闭
  subtitleWindow.on('closed', () => {
    subtitleWindow = null
  })

  // 注册拖拽 IPC：渲染进程通过 -webkit-app-region: drag 不工作于 transparent frameless 窗口
  // 所以我们用 IPC 方式实现拖拽
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

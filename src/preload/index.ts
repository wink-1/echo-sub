import { contextBridge, ipcRenderer, desktopCapturer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

const electronAPI = {
  onStartCapture: (callback: () => void) =>
    ipcRenderer.on(IPC_CHANNELS.START_CAPTURE, () => callback()),
  onStopCapture: (callback: () => void) =>
    ipcRenderer.on(IPC_CHANNELS.STOP_CAPTURE, () => callback()),
  startCapture: () => ipcRenderer.invoke(IPC_CHANNELS.START_CAPTURE),
  stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_CAPTURE),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  onTranslationUpdate: (callback: (data: unknown) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_UPDATE, (_event, data) => callback(data)),
  onTranslationCorrection: (callback: (data: unknown) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_CORRECTION, (_event, data) => callback(data)),
  onBackendStatus: (callback: (status: string) => void) =>
    ipcRenderer.on(IPC_CHANNELS.BACKEND_STATUS, (_event, status) => callback(status)),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),

  // 发送 PCM 音频数据到主进程
  sendAudioPCMData: (data: Uint8Array) => {
    ipcRenderer.send('audio-pcm-data', data.buffer)
  },

  // 检查是否正在捕获
  isAudioCapturing: () => ipcRenderer.invoke('is-audio-capturing'),

  // 字幕悬浮窗控制
  openSubtitleWindow: () => ipcRenderer.invoke('open-subtitle-window'),
  closeSubtitleWindow: () => ipcRenderer.invoke('close-subtitle-window'),
  isSubtitleWindowOpen: () => ipcRenderer.invoke('is-subtitle-window-open'),

  // 字幕窗口拖拽
  subtitleDrag: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('subtitle-drag', deltaX, deltaY),

  // 获取系统音频源 ID
  getSystemAudioSource: async (): Promise<string | null> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      })
      if (sources.length > 0) {
        const screenSource = sources.find(s =>
          s.name === 'Entire Screen' || s.name === 'Screen 1'
        ) || sources[0]
        console.log('[preload] Got screen source:', screenSource.id, screenSource.name)
        return screenSource.id
      }
      return null
    } catch (err) {
      console.error('[preload] Failed to get system audio source:', err)
      return null
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

import { contextBridge, ipcRenderer, desktopCapturer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'

const electronAPI = {
  onStartCapture: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.START_CAPTURE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.START_CAPTURE, handler)
  },
  onStopCapture: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.STOP_CAPTURE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STOP_CAPTURE, handler)
  },
  startCapture: () => ipcRenderer.invoke(IPC_CHANNELS.START_CAPTURE),
  stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_CAPTURE),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  onTranslationUpdate: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TRANSLATION_UPDATE, handler)
  },
  onTranslationCorrection: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_CORRECTION, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TRANSLATION_CORRECTION, handler)
  },
  onBackendStatus: (callback: (status: string) => void) => {
    const handler = (_event: unknown, status: string) => callback(status)
    ipcRenderer.on(IPC_CHANNELS.BACKEND_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BACKEND_STATUS, handler)
  },
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),

  sendAudioPCMData: (data: Uint8Array) => {
    ipcRenderer.send('audio-pcm-data', data.buffer)
  },

  isAudioCapturing: () => ipcRenderer.invoke('is-audio-capturing'),

  openSubtitleWindow: () => ipcRenderer.invoke('open-subtitle-window'),
  closeSubtitleWindow: () => ipcRenderer.invoke('close-subtitle-window'),
  isSubtitleWindowOpen: () => ipcRenderer.invoke('is-subtitle-window-open'),

  subtitleDrag: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('subtitle-drag', deltaX, deltaY),

  toggleAlwaysOnTop: (): Promise<{ alwaysOnTop: boolean }> =>
    ipcRenderer.invoke('toggle-always-on-top'),

  reportAudioSource: (source: string) => {
    ipcRenderer.send('audio-source-changed', source)
  },

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

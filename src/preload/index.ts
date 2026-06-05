import { contextBridge, ipcRenderer } from 'electron'
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
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

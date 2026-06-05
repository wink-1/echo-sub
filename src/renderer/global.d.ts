import { AppSettings, BackendMessage } from './shared/types'

export interface ElectronAPI {
  onStartCapture: (callback: () => void) => void
  onStopCapture: (callback: () => void) => void
  startCapture: () => Promise<{ success: boolean }>
  stopCapture: () => Promise<{ success: boolean }>
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  onTranslationUpdate: (callback: (data: unknown) => void) => void
  onTranslationCorrection: (callback: (data: unknown) => void) => void
  onBackendStatus: (callback: (status: string) => void) => void
  getSettings: () => Promise<AppSettings>
  sendAudioPCMData: (data: ArrayBuffer) => void
  isAudioCapturing: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}

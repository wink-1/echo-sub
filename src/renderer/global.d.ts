import { IPC_CHANNELS } from '../shared/types'

declare global {
  interface Window {
    electronAPI: {
      onStartCapture: (callback: () => void) => void
      onStopCapture: (callback: () => void) => void
      startCapture: () => Promise<{ success: boolean }>
      stopCapture: () => Promise<{ success: boolean }>
      updateSettings: (settings: Record<string, unknown>) => Promise<unknown>
      onTranslationUpdate: (callback: (data: unknown) => void) => void
      onTranslationCorrection: (callback: (data: unknown) => void) => void
      onBackendStatus: (callback: (status: string) => void) => void
      getSettings: () => Promise<unknown>
      sendAudioPCMData: (data: ArrayBuffer | Buffer) => void
      isAudioCapturing: () => Promise<boolean>
      getSystemAudioSource: () => Promise<string | null>
    }
  }
}

export {}

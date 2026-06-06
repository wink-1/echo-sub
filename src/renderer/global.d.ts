export {}

declare global {
  interface Window {
    electronAPI: {
      startCapture: () => Promise<{ success: boolean }>
      stopCapture: () => Promise<{ success: boolean }>
      updateSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>
      getSettings: () => Promise<Record<string, unknown>>
      isAudioCapturing: () => Promise<boolean>

      onStartCapture: (callback: () => void) => () => void
      onStopCapture: (callback: () => void) => () => void
      onTranslationUpdate: (callback: (data: unknown) => void) => () => void
      onTranslationCorrection: (callback: (data: unknown) => void) => () => void
      onBackendStatus: (callback: (status: string) => void) => () => void

      sendAudioPCMData: (data: Uint8Array) => void
      reportAudioSource: (source: string) => void

      getPlatform: () => string
      checkScreenRecordPermission: () => Promise<{ granted: boolean; status: string; platform: string }>

      openSubtitleWindow: () => Promise<{ success: boolean }>
      closeSubtitleWindow: () => Promise<{ success: boolean }>
      isSubtitleWindowOpen: () => Promise<boolean>
      toggleAlwaysOnTop: () => Promise<{ alwaysOnTop: boolean }>
      resizeSubtitleWindow: (height: number) => void
    }
  }
}

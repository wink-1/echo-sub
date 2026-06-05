export {}

declare global {
  interface Window {
    electronAPI: {
      // 控制
      startCapture: () => Promise<{ success: boolean }>
      stopCapture: () => Promise<{ success: boolean }>
      updateSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>
      getSettings: () => Promise<Record<string, unknown>>
      isAudioCapturing: () => Promise<boolean>

      // 事件监听
      onStartCapture: (callback: () => void) => void
      onStopCapture: (callback: () => void) => void
      onTranslationUpdate: (callback: (data: unknown) => void) => void
      onTranslationCorrection: (callback: (data: unknown) => void) => void
      onBackendStatus: (callback: (status: string) => void) => void

      // 音频
      sendAudioPCMData: (data: Uint8Array) => void

      // 系统音频源
      getSystemAudioSource: () => Promise<string | null>

      // 字幕悬浮窗
      openSubtitleWindow: () => Promise<{ success: boolean }>
      closeSubtitleWindow: () => Promise<{ success: boolean }>
      isSubtitleWindowOpen: () => Promise<boolean>
    }
  }
}

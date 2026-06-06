// 共享类型定义

/** 翻译段落状态 */
export type SegmentStatus = 'partial' | 'confirmed' | 'corrected'

/** 翻译段落 */
export interface TranslationSegment {
  id: string
  sourceText: string
  translatedText: string
  status: SegmentStatus
  timestamp: number
  language: string
}

/** WebSocket 消息类型 (Python → Electron) */
export type BackendMessageType =
  | 'asr_partial'
  | 'asr_final'
  | 'translation_partial'
  | 'translation_final'
  | 'correction'
  | 'status'
  | 'error'

/** 后端 WebSocket 消息 */
export interface BackendMessage {
  type: BackendMessageType
  data: {
    id?: string
    text: string
    /** whisper 完整输出（asr_partial 用于实时显示完整语句进度） */
    fullText?: string
    language?: string
    originalText?: string
    correctedText?: string
    changed?: boolean
    message?: string
  }
}

/** WebSocket 消息类型 (Electron → Python) */
export type FrontendMessageType =
  | 'audio_chunk'
  | 'start'
  | 'stop'
  | 'set_language'

/** 前端 WebSocket 消息 */
export interface FrontendMessage {
  type: FrontendMessageType
  data: {
    audio?: ArrayBuffer
    language?: string
  }
}

/** 应用设置 */
export interface AppSettings {
  sourceLanguage: string
  targetLanguage: string
  fontSize: number
  showBilingual: boolean
  windowOpacity: number
}

/** IPC 通道名 */
export const IPC_CHANNELS = {
  START_CAPTURE: 'start-capture',
  STOP_CAPTURE: 'stop-capture',
  UPDATE_SETTINGS: 'update-settings',
  TRANSLATION_UPDATE: 'translation-update',
  TRANSLATION_CORRECTION: 'translation-correction',
  BACKEND_STATUS: 'backend-status',
  GET_SETTINGS: 'get-settings',
  RESIZE_SUBTITLE_WINDOW: 'resize-subtitle-window'
} as const

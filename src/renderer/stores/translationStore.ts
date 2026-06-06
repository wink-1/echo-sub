import { create } from 'zustand'
import { TranslationSegment } from '../../shared/types'
import { SUBTITLE_CONFIG } from '../../shared/config'

/** ASR 实时识别占位段 ID，asr_final 到达后会被替换 */
export const ASR_LIVE_ID = '__asr_live__'

interface TranslationState {
  segments: TranslationSegment[]
  isCapturing: boolean
  isAsrOnly: boolean
  addSegment: (segment: TranslationSegment) => void
  updateSegment: (id: string, updates: Partial<TranslationSegment>) => void
  correctSegment: (id: string, correctedText: string) => void
  removeSegment: (id: string) => void
  clearSegments: () => void
  setCapturing: (capturing: boolean) => void
  setAsrOnly: (asrOnly: boolean) => void
}

export const useTranslationStore = create<TranslationState>((set) => ({
  segments: [],
  isCapturing: false,
  isAsrOnly: false,

  addSegment: (segment) =>
    set((state) => {
      const index = state.segments.findIndex((s) => s.id === segment.id)
      if (index >= 0) {
        const newSegments = [...state.segments]
        const old = newSegments[index]
        newSegments[index] = {
          ...old,
          // 用 || 而不是 ?? — 空字符串视为"未提供"，保留旧值
          // 避免 translatedText:'' 覆盖已有翻译（如后端重启 ID 冲突）
          sourceText: segment.sourceText || old.sourceText,
          translatedText: segment.translatedText || old.translatedText,
          status: segment.status ?? old.status,
          language: segment.language ?? old.language,
        }
        return { segments: newSegments }
      }
      return { segments: [...state.segments, segment].slice(-SUBTITLE_CONFIG.MAX_STORED_SEGMENTS) }
    }),

  updateSegment: (id, updates) =>
    set((state) => {
      const index = state.segments.findIndex((s) => s.id === id)
      if (index >= 0) {
        const newSegments = [...state.segments]
        newSegments[index] = { ...newSegments[index], ...updates }
        return { segments: newSegments }
      }
      return state
    }),

  correctSegment: (id, correctedText) =>
    set((state) => ({
      segments: state.segments.map((s) =>
        s.id === id
          ? { ...s, translatedText: correctedText, status: 'corrected' as const }
          : s
      )
    })),

  removeSegment: (id) =>
    set((state) => ({
      segments: state.segments.filter((s) => s.id !== id)
    })),

  clearSegments: () => set({ segments: [] }),

  setCapturing: (capturing) => set({ isCapturing: capturing }),
  setAsrOnly: (asrOnly) => set({ isAsrOnly: asrOnly }),
}))

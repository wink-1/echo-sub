import { create } from 'zustand'
import { TranslationSegment } from '../../shared/types'

interface TranslationState {
  segments: TranslationSegment[]
  isCapturing: boolean
  addSegment: (segment: TranslationSegment) => void
  updateSegment: (id: string, updates: Partial<TranslationSegment>) => void
  correctSegment: (id: string, correctedText: string) => void
  clearSegments: () => void
  setCapturing: (capturing: boolean) => void
}

export const useTranslationStore = create<TranslationState>((set) => ({
  segments: [],
  isCapturing: false,

  addSegment: (segment) =>
    set((state) => {
      const existing = state.segments.findIndex((s) => s.id === segment.id)
      if (existing >= 0) {
        // 更新已有段落
        const newSegments = [...state.segments]
        newSegments[existing] = { ...newSegments[existing], ...segment }
        return { segments: newSegments }
      }
      // 保留最近 50 段
      return { segments: [...state.segments, segment].slice(-50) }
    }),

  updateSegment: (id, updates) =>
    set((state) => {
      const index = state.segments.findIndex((s) => s.id === id)
      if (index >= 0) {
        // 更新已有段落
        const newSegments = [...state.segments]
        newSegments[index] = { ...newSegments[index], ...updates }
        return { segments: newSegments }
      }
      // 找不到对应段落，添加新段落
      return {
        segments: [
          ...state.segments,
          {
            id,
            sourceText: updates.sourceText || '',
            translatedText: updates.translatedText || '',
            status: updates.status || 'confirmed',
            timestamp: Date.now(),
            language: updates.language || 'en'
          }
        ].slice(-50)
      }
    }),

  correctSegment: (id, correctedText) =>
    set((state) => ({
      segments: state.segments.map((s) =>
        s.id === id
          ? { ...s, translatedText: correctedText, status: 'corrected' as const }
          : s
      )
    })),

  clearSegments: () => set({ segments: [] }),

  setCapturing: (capturing) => set({ isCapturing: capturing })
}))

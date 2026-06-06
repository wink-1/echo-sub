import { create } from 'zustand'
import { TranslationSegment } from '../../shared/types'
import { SUBTITLE_CONFIG } from '../../shared/config'

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
      const index = state.segments.findIndex((s) => s.id === segment.id)
      if (index >= 0) {
        const newSegments = [...state.segments]
        const old = newSegments[index]
        newSegments[index] = {
          ...old,
          sourceText: segment.sourceText ?? old.sourceText,
          translatedText: segment.translatedText ?? old.translatedText,
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

  clearSegments: () => set({ segments: [] }),

  setCapturing: (capturing) => set({ isCapturing: capturing })
}))

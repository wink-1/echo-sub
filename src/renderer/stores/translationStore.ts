import { create } from 'zustand'
import { TranslationSegment } from '../../shared/types'

const STORAGE_KEY = 'echosub-translation-history'

function loadFromStorage(): TranslationSegment[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.warn('Failed to load translation history:', e)
  }
  return []
}

function saveToStorage(segments: TranslationSegment[]): void {
  try {
    // 只持久化已确认和已纠错的段落（过滤掉 partial 状态的）
    const persistable = segments.filter(s => s.status !== 'partial')
    if (persistable.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable.slice(-50)))
    }
  } catch (e) {
    console.warn('Failed to save translation history:', e)
  }
}

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
  segments: loadFromStorage(),
  isCapturing: false,

  addSegment: (segment) =>
    set((state) => {
      const index = state.segments.findIndex((s) => s.id === segment.id)
      let newSegments: TranslationSegment[]
      if (index >= 0) {
        newSegments = [...state.segments]
        const old = newSegments[index]
        newSegments[index] = {
          ...old,
          sourceText: segment.sourceText || old.sourceText,
          translatedText: segment.translatedText || old.translatedText,
          status: segment.status || old.status,
          language: segment.language || old.language,
        }
      } else {
        newSegments = [...state.segments, segment].slice(-50)
      }
      // confirmed/corrected 状态时保存到 localStorage
      if (segment.status === 'confirmed' || segment.status === 'corrected') {
        saveToStorage(newSegments)
      }
      return { segments: newSegments }
    }),

  updateSegment: (id, updates) =>
    set((state) => {
      const index = state.segments.findIndex((s) => s.id === id)
      let newSegments: TranslationSegment[]
      if (index >= 0) {
        newSegments = [...state.segments]
        newSegments[index] = { ...newSegments[index], ...updates }
      } else {
        newSegments = [
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
      if (updates.status === 'confirmed' || updates.status === 'corrected') {
        saveToStorage(newSegments)
      }
      return { segments: newSegments }
    }),

  correctSegment: (id, correctedText) =>
    set((state) => {
      const newSegments = state.segments.map((s) =>
        s.id === id
          ? { ...s, translatedText: correctedText, status: 'corrected' as const }
          : s
      )
      saveToStorage(newSegments)
      return { segments: newSegments }
    }),

  clearSegments: () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    set({ segments: [] })
  },

  setCapturing: (capturing) => set({ isCapturing: capturing })
}))

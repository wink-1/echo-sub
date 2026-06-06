import { useEffect, useRef } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import ErrorBoundary from './components/ErrorBoundary'
import { useTranslationStore } from './stores/translationStore'

export default function App(): JSX.Element {
  const storeRef = useRef(useTranslationStore.getState())

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('electronAPI not available')
      return
    }

    const store = storeRef.current

    // 监听翻译更新
    const unsubUpdate = window.electronAPI.onTranslationUpdate((data: unknown) => {
      const msg = data as {
        type: string
        data: {
          id?: string
          text: string
          originalText?: string
          language?: string
        }
      }

      console.log('[App] Translation update:', msg.type, msg.data.text?.slice(0, 30))

      if (msg.type === 'asr_final') {
        // ASR 最终结果：只设置原文，translatedText 设为空（等待翻译）
        store.addSegment({
          id: msg.data.id || `seg-${Date.now()}`,
          sourceText: msg.data.text,
          translatedText: '',
          status: 'partial',
          timestamp: Date.now(),
          language: msg.data.language || 'en'
        })
      } else if (msg.type === 'translation_partial') {
        store.addSegment({
          id: msg.data.id || `seg-${Date.now()}`,
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'partial',
          timestamp: Date.now(),
          language: msg.data.language || 'en'
        })
      } else if (msg.type === 'translation_final') {
        store.addSegment({
          id: msg.data.id || `seg-${Date.now()}`,
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'confirmed',
          timestamp: Date.now(),
          language: msg.data.language || 'en'
        })
      } else {
        // 未处理的消息类型（如 asr_partial），静默跳过
        console.debug('[App] Unhandled message type:', msg.type)
      }
    })

    // 监听翻译纠错
    const unsubCorrection = window.electronAPI.onTranslationCorrection((data: unknown) => {
      const msg = data as {
        data: {
          id?: string
          correctedText: string
          changed: boolean
        }
      }
      if (msg.data.changed) {
        store.correctSegment(msg.data.id || '', msg.data.correctedText)
      }
    })

    // 监听后端状态
    const unsubStatus = window.electronAPI.onBackendStatus((status: string) => {
      console.log('[App] Backend status:', status)
    })

    return () => {
      console.log('[App] Cleanup listeners')
      unsubUpdate()
      unsubCorrection()
      unsubStatus()
    }
  }, [])

  // 始终显示字幕浮窗（唯一窗口）
  return (
    <ErrorBoundary>
      <SubtitleOverlay />
    </ErrorBoundary>
  )
}

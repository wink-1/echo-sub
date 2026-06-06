import { useEffect, useRef } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import ErrorBoundary from './components/ErrorBoundary'
import { useTranslationStore, ASR_LIVE_ID } from './stores/translationStore'

/**
 * 前端消息处理策略（简化版）:
 *
 * 后端已负责增量提取 (_extract_increment)，前端不再做 extractNewContent。
 * - asr_partial: 用 fullText 显示完整语句进度，用 text (增量) 不做二次提取
 * - asr_final:   用 text (增量) 直接创建正式段，不再做 extractNewContent
 * - translation: 按 segment_id 匹配目标段，translatedText 设为完整翻译文本
 *   （不再做 extractNewContent，避免翻译被碎片化）
 */
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
          fullText?: string
          originalText?: string
          language?: string
        }
      }

      console.log('[App] Update:', msg.type, msg.data.id, msg.data.text?.slice(0, 30))

      if (msg.type === 'asr_partial') {
        // 实时识别中间结果 — 用 fullText 显示完整语句进度
        const displayText = msg.data.fullText || msg.data.text
        if (displayText) {
          store.addSegment({
            id: ASR_LIVE_ID,
            sourceText: displayText,
            translatedText: '',
            status: 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else if (msg.type === 'asr_final') {
        // 语句完成 — 清除实时占位段，用增量文本创建正式段
        store.removeSegment(ASR_LIVE_ID)

        if (!msg.data.text) {
          console.debug('[App] asr_final with no text, skipping')
          return
        }

        const segId = msg.data.id || `seg-${Date.now()}`

        if (store.isAsrOnly) {
          store.addSegment({
            id: segId,
            sourceText: msg.data.text,
            translatedText: msg.data.text,
            status: 'confirmed',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        } else {
          store.addSegment({
            id: segId,
            sourceText: msg.data.text,
            translatedText: '',
            status: 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else if (msg.type === 'translation_partial' || msg.type === 'translation_final') {
        // 翻译结果 — 按 segment_id 匹配对应段，设为完整翻译文本
        const segId = msg.data.id || ''
        const fullTranslation = msg.data.text
        const isFinal = msg.type === 'translation_final'

        if (!fullTranslation) {
          console.debug('[App] translation with no text, skipping')
          return
        }

        // 按 ID 查找对应段（不再用 "第一个等待段" 的方式）
        const targetSeg = store.segments.find((s) => s.id === segId)

        if (targetSeg) {
          store.updateSegment(targetSeg.id, {
            translatedText: fullTranslation,
            status: isFinal ? 'confirmed' : 'partial',
          })
        } else {
          // 段不在列表中（可能已被滚动移除），创建新段
          store.addSegment({
            id: segId,
            sourceText: msg.data.originalText || fullTranslation,
            translatedText: fullTranslation,
            status: isFinal ? 'confirmed' : 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else {
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

    // 监听后端状态（检测 ASR 测试模式）
    const unsubStatus = window.electronAPI.onBackendStatus((status: string) => {
      console.log('[App] Backend status:', status)
      if (status.startsWith('asr_only')) {
        store.setAsrOnly(true)
        console.log('[App] ASR-only mode activated — no translation will be performed')
      }
    })

    return () => {
      console.log('[App] Cleanup listeners')
      unsubUpdate()
      unsubCorrection()
      unsubStatus()
    }
  }, [])

  return (
    <ErrorBoundary>
      <SubtitleOverlay />
    </ErrorBoundary>
  )
}
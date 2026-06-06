import { useEffect, useRef } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import ErrorBoundary from './components/ErrorBoundary'
import { useTranslationStore, ASR_LIVE_ID } from './stores/translationStore'

/**
 * 从累积文本中提取增量部分。
 * ASR/翻译后端经常发送累积文本（每次都包含从开始到当前的全部内容），
 * 此函数对比上次已确认的边界，只返回新增的部分。
 *
 * 例如:  prev="Hello."  current="Hello. World."
 *        → 返回 "World."
 */
function extractIncrement(current: string, prev: string): string {
  if (!prev) return current
  if (current.startsWith(prev)) {
    const suffix = current.slice(prev.length).trim()
    return suffix || current // 无增量时保留原文（可能是 ASR 修正）
  }
  // 不以旧文本开头 → ASR 可能做了大范围修正，直接使用全文
  return current
}

export default function App(): JSX.Element {
  const storeRef = useRef(useTranslationStore.getState())

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('electronAPI not available')
      return
    }

    const store = storeRef.current

    // 累积文本边界追踪器 — 用于从累积文本中提取增量
    let lastAsrText = ''
    let lastTranslationText = ''

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

      if (msg.type === 'asr_partial') {
        // ASR 实时识别中间结果 → 只显示增量部分
        const newPartial = extractIncrement(msg.data.text, lastAsrText)
        if (newPartial) {
          store.addSegment({
            id: ASR_LIVE_ID,
            sourceText: newPartial,
            translatedText: '',
            status: 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else if (msg.type === 'asr_final') {
        // ASR 最终结果 → 清除实时占位段，提取增量创建正式段
        store.removeSegment(ASR_LIVE_ID)

        const newSource = extractIncrement(msg.data.text, lastAsrText)
        // 更新累积边界（无论是否有增量，都要更新以追踪最新全文）
        lastAsrText = msg.data.text

        if (!newSource) {
          // 无新内容（可能只是 ASR 对已有文本的小修正），跳过
          console.debug('[App] asr_final with no increment, skipping')
          return
        }

        if (store.isAsrOnly) {
          // ASR 测试模式：直接显示原文，状态为 confirmed
          store.addSegment({
            id: msg.data.id || `seg-${Date.now()}`,
            sourceText: newSource,
            translatedText: newSource,
            status: 'confirmed',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        } else {
          // 正常模式：增量原文入队，等待翻译
          store.addSegment({
            id: msg.data.id || `seg-${Date.now()}`,
            sourceText: newSource,
            translatedText: '',
            status: 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else if (msg.type === 'translation_partial' || msg.type === 'translation_final') {
        // 翻译结果 → 清除实时占位段
        store.removeSegment(ASR_LIVE_ID)

        const fullTranslation = msg.data.text
        const newTranslation = extractIncrement(fullTranslation, lastTranslationText)
        // 更新累积翻译边界
        lastTranslationText = fullTranslation

        if (!newTranslation) {
          console.debug('[App] translation with no increment, skipping')
          return
        }

        const isFinal = msg.type === 'translation_final'

        // 寻找第一个等待翻译的段（有 sourceText 但无 translatedText）
        const pendingSeg = store.segments.find(
          (s) => s.id !== ASR_LIVE_ID && s.status === 'partial' && !s.translatedText
        )

        if (pendingSeg) {
          // 更新等待段：填入增量翻译
          store.updateSegment(pendingSeg.id, {
            translatedText: newTranslation,
            status: isFinal ? 'confirmed' : 'partial',
          })
        } else {
          // 没有等待段 → 用增量原文 + 增量翻译创建新段
          const originalText = msg.data.originalText || ''
          const newOriginal = extractIncrement(originalText, lastAsrText)
          store.addSegment({
            id: msg.data.id || `seg-${Date.now()}`,
            sourceText: newOriginal || originalText,
            translatedText: newTranslation,
            status: isFinal ? 'confirmed' : 'partial',
            timestamp: Date.now(),
            language: msg.data.language || 'en',
          })
        }
      } else {
        // 未处理的消息类型，静默跳过
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

  // 始终显示字幕浮窗（唯一窗口）
  return (
    <ErrorBoundary>
      <SubtitleOverlay />
    </ErrorBoundary>
  )
}
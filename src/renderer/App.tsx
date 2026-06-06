import { useEffect, useRef } from 'react'
import SubtitleOverlay from './components/SubtitleOverlay'
import ErrorBoundary from './components/ErrorBoundary'
import { useTranslationStore, ASR_LIVE_ID } from './stores/translationStore'

/**
 * 从新文本中提取增量内容，支持三种 ASR 后端输出模式：
 *
 * 1. 累积模式：newText 以 prevText 为前缀，只需截取尾部
 *    prev="Hello."  current="Hello. World."  → "World."
 *
 * 2. 重叠模式：newText 的开头与 prevText 的尾部有重叠（ASR 为翻译模型提供上下文）
 *    prev="...serving others. The psychologist"
 *    current="The psychologist Dan McAdams calls this..."  → "Dan McAdams calls this..."
 *    通过逐词从 prevText 尾部向头部搜索，找到最长重叠后提取增量。
 *
 * 3. 无重叠：ASR 大范围修正或重启，直接使用全文。
 */
function extractNewContent(newText: string, prevText: string): string {
  if (!prevText) return newText.trim()

  const trimmedNew = newText.trim()
  const trimmedPrev = prevText.trim()

  // 模式 1: 纯累积 — 新文本以旧文本为前缀
  if (trimmedNew.startsWith(trimmedPrev)) {
    const suffix = trimmedNew.slice(trimmedPrev.length).trim()
    return suffix || trimmedNew // 无增量时保留原文（可能是 ASR 小修正）
  }

  // 模式 2: 重叠 — prevText 尾部与 newText 头部有共同片段
  // 从 prevText 尾部取词（最多取最后 ~50 词），逐个缩短寻找与 newText 开头的重叠
  const prevWords = trimmedPrev.split(/\s+/)
  const newWords = trimmedNew.split(/\s+/)
  const maxOverlapWords = Math.min(prevWords.length, 50)

  for (let overlapLen = maxOverlapWords; overlapLen >= 1; overlapLen--) {
    const overlapCandidate = prevWords.slice(-overlapLen).join(' ')
    if (overlapCandidate && trimmedNew.startsWith(overlapCandidate)) {
      const afterOverlap = trimmedNew.slice(overlapCandidate.length).trim()
      if (afterOverlap) return afterOverlap
      // 整段都是重叠 → 无新内容
      return ''
    }
  }

  // 模式 3: 无重叠 → ASR 可能做了大修正，返回全文
  return trimmedNew
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
        const newPartial = extractNewContent(msg.data.text, lastAsrText)
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

        const newSource = extractNewContent(msg.data.text, lastAsrText)
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
        const newTranslation = extractNewContent(fullTranslation, lastTranslationText)
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
          const newOriginal = extractNewContent(originalText, lastAsrText)
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
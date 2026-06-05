import { useState, useEffect } from 'react'
import ControlPanel from './components/ControlPanel'
import SubtitleOverlay from './components/SubtitleOverlay'
import { useTranslationStore } from './stores/translationStore'

export default function App(): JSX.Element {
  const [isSubtitleMode, setIsSubtitleMode] = useState(false)
  const { addSegment, updateSegment, correctSegment } = useTranslationStore()

  useEffect(() => {
    // 检测是否是字幕悬浮窗模式
    const hash = window.location.hash
    setIsSubtitleMode(hash === '#subtitle')
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return

    // 监听翻译更新
    window.electronAPI.onTranslationUpdate((data: unknown) => {
      const msg = data as {
        type: string
        data: {
          id?: string
          text: string
          originalText?: string
          language?: string
        }
      }

      if (msg.type === 'translation_partial' || msg.type === 'asr_partial') {
        addSegment({
          id: msg.data.id || `seg-${Date.now()}`,
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'partial',
          timestamp: Date.now(),
          language: msg.data.language || 'en'
        })
      } else if (msg.type === 'translation_final' || msg.type === 'asr_final') {
        updateSegment(msg.data.id || `seg-${Date.now()}`, {
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'confirmed'
        })
      }
    })

    // 监听翻译纠错
    window.electronAPI.onTranslationCorrection((data: unknown) => {
      const msg = data as {
        data: {
          id?: string
          correctedText: string
          changed: boolean
        }
      }
      if (msg.data.changed) {
        correctSegment(msg.data.id || '', msg.data.correctedText)
      }
    })

    // 监听后端状态
    window.electronAPI.onBackendStatus((status: string) => {
      console.log('Backend status:', status)
    })
  }, [addSegment, updateSegment, correctSegment])

  if (isSubtitleMode) {
    return <SubtitleOverlay />
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-2xl">🎯</span>
          EchoSub
        </h1>
        <p className="text-sm text-gray-400 mt-1">AI同声传译助手</p>
      </header>

      <main className="flex-1 p-4 space-y-4">
        <ControlPanel />
        <SubtitleOverlay />
      </main>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import ControlPanel from './components/ControlPanel'
import SubtitleOverlay from './components/SubtitleOverlay'
import { useTranslationStore } from './stores/translationStore'

export default function App(): JSX.Element {
  const [isSubtitleMode, setIsSubtitleMode] = useState(false)
  const storeRef = useRef(useTranslationStore.getState())

  useEffect(() => {
    // 检测是否是字幕悬浮窗模式
    const hash = window.location.hash
    setIsSubtitleMode(hash === '#subtitle')
  }, [])

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

      if (msg.type === 'translation_partial' || msg.type === 'asr_partial') {
        store.addSegment({
          id: msg.data.id || `seg-${Date.now()}`,
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'partial',
          timestamp: Date.now(),
          language: msg.data.language || 'en'
        })
      } else if (msg.type === 'translation_final' || msg.type === 'asr_final') {
        store.updateSegment(msg.data.id || `seg-${Date.now()}`, {
          sourceText: msg.data.originalText || '',
          translatedText: msg.data.text,
          status: 'confirmed'
        })
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
      // zustand 的 IPC 监听无法取消,但组件卸载时不需要处理
      console.log('[App] Cleanup listeners')
    }
  }, [])

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

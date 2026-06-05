import { useState, useEffect, useRef } from 'react'
import ControlPanel from './components/ControlPanel'
import SubtitleOverlay from './components/SubtitleOverlay'
import { useTranslationStore } from './stores/translationStore'

export default function App(): JSX.Element {
  const [isSubtitleMode, setIsSubtitleMode] = useState(false)
  const storeRef = useRef(useTranslationStore.getState())

  useEffect(() => {
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
      console.log('[App] Cleanup listeners')
    }
  }, [])

  // 字幕悬浮窗模式
  if (isSubtitleMode) {
    return <SubtitleOverlay />
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* 头部 */}
      <header className="p-4 border-b border-gray-700/50 bg-gray-800/50 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg">
              🎯
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">EchoSub</h1>
              <p className="text-xs text-gray-400">AI 同声传译助手</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded-md bg-green-500/20 text-green-400 text-xs font-medium">
              ● 本地运行
            </span>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* 控制面板 */}
        <ControlPanel />

        {/* 字幕显示区域 */}
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <h2 className="text-sm font-medium text-gray-300">实时字幕</h2>
            <button
              onClick={() => storeRef.current.clearSegments()}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-700/50"
            >
              清空
            </button>
          </div>
          <div className="p-4">
            <SubtitleOverlay />
          </div>
        </div>

        {/* 使用说明 */}
        <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/30">
          <h3 className="text-xs font-medium text-gray-400 mb-2">使用说明</h3>
          <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
            <li>点击「开始翻译」启动音频捕获</li>
            <li>系统音频捕获失败时会自动降级到麦克风</li>
            <li>首次使用需要在系统设置中授权屏幕录制权限</li>
            <li>字幕会自动保存最近 50 条记录</li>
          </ul>
        </div>
      </main>

      {/* 底部 */}
      <footer className="p-3 text-center text-[10px] text-gray-600 border-t border-gray-800">
        EchoSub v0.1.0 · Powered by faster-whisper + Ollama
      </footer>
    </div>
  )
}

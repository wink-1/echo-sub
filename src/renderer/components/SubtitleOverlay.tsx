import { useEffect, useRef, useCallback } from 'react'
import { useTranslationStore } from '../stores/translationStore'

export default function SubtitleOverlay(): JSX.Element {
  const { segments } = useTranslationStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [segments])

  // 拖拽处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只在拖拽区域（顶部栏）上响应
    isDragging.current = true
    lastPos.current = { x: e.screenX, y: e.screenY }
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const deltaX = e.screenX - lastPos.current.x
    const deltaY = e.screenY - lastPos.current.y
    lastPos.current = { x: e.screenX, y: e.screenY }
    window.electronAPI?.subtitleDrag?.(deltaX, deltaY)
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  // 显示最近的 5 段
  const visibleSegments = segments.slice(-5)

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'partial':
        return 'opacity-70 border-l-2 border-yellow-400/60'
      case 'confirmed':
        return 'opacity-100 border-l-2 border-green-400/80'
      case 'corrected':
        return 'opacity-100 border-l-2 border-blue-400 bg-blue-500/10'
      default:
        return 'opacity-80'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'partial':
        return <span className="text-[9px] text-yellow-400/80 animate-pulse">识别中</span>
      case 'confirmed':
        return <span className="text-[9px] text-green-400/70">✓</span>
      case 'corrected':
        return <span className="text-[9px] text-blue-400/70">✎</span>
      default:
        return null
    }
  }

  return (
    <div
      className="w-full select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 拖拽手柄 - 顶部可拖动区域 */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-center py-1.5 cursor-grab active:cursor-grabbing mb-1 group"
        title="拖拽移动字幕窗口"
      >
        <div className="flex items-center gap-1">
          <div className="w-8 h-1 rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors" />
        </div>
      </div>

      {/* 字幕显示区域 */}
      <div
        ref={containerRef}
        className="space-y-1.5 max-h-[60vh] overflow-y-auto scrollbar-hide"
      >
        {visibleSegments.map((seg) => (
          <div
            key={seg.id}
            className={`rounded-lg px-3 py-2 bg-black/70 backdrop-blur-md transition-all duration-300 ${getStatusStyle(seg.status)}`}
          >
            {/* 翻译文本 + 状态 */}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {/* 源语言文本 */}
                {seg.sourceText && seg.sourceText !== seg.translatedText && (
                  <div className="text-[11px] text-gray-400/70 mb-0.5 leading-relaxed">
                    {seg.sourceText}
                  </div>
                )}
                {/* 翻译文本 */}
                <div
                  className="text-sm font-medium leading-relaxed text-white"
                  style={{
                    textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)'
                  }}
                >
                  {seg.translatedText}
                  {seg.status === 'partial' && (
                    <span className="inline-block w-0.5 h-3.5 bg-yellow-400 ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 pt-0.5">
                {getStatusLabel(seg.status)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 空状态 */}
      {segments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-gray-500">
          <div className="text-3xl mb-2">🎙️</div>
          <div className="text-xs">等待音频输入...</div>
        </div>
      )}
    </div>
  )
}

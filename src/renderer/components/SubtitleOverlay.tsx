import { useEffect, useRef, useCallback } from 'react'
import { useTranslationStore } from '../stores/translationStore'

export default function SubtitleOverlay(): JSX.Element {
  const { segments } = useTranslationStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [segments])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastPos.current = { x: e.screenX, y: e.screenY }
  }, [])

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const deltaX = e.screenX - lastPos.current.x
    const deltaY = e.screenY - lastPos.current.y
    lastPos.current = { x: e.screenX, y: e.screenY }
    window.electronAPI?.subtitleDrag?.(deltaX, deltaY)
  }, [])

  const handleDragEnd = useCallback(() => {
    isDragging.current = false
  }, [])

  const visibleSegments = segments.slice(-8)

  return (
    <div
      className="w-full h-full select-none rounded-2xl"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.65) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* 标题栏 - sticky 置顶，浏览器原生保证始终在顶部 */}
      <div
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        className="flex items-center justify-between px-4 py-2.5 cursor-grab active:cursor-grabbing"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'linear-gradient(180deg, rgba(20,20,20,0.95) 0%, rgba(10,10,10,0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          borderTopLeftRadius: '1rem',
          borderTopRightRadius: '1rem',
          flexShrink: 0
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-white/60 tracking-wider">
            EchoSub 字幕悬浮窗
          </span>
          {segments.length > 0 && (
            <span
              className="text-[10px] font-medium flex items-center gap-1"
              style={{ color: 'rgba(74, 222, 128, 0.7)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'rgba(74, 222, 128, 0.8)' }} />
              收录中
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-30 hover:opacity-60 transition-opacity">
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
        </div>
      </div>

      {/* 字幕滚动区 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 pt-1.5 space-y-1.5 scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        {visibleSegments.map((seg) => (
          <div
            key={seg.id}
            className="animate-fadeIn rounded-xl px-3.5 py-2.5 transition-all"
            style={{
              backgroundColor: seg.status === 'corrected'
                ? 'rgba(59, 130, 246, 0.15)'
                : seg.status === 'partial'
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.08)',
              borderLeft: seg.status === 'partial'
                ? '2px solid rgba(250, 204, 21, 0.6)'
                : seg.status === 'corrected'
                  ? '2px solid rgba(96, 165, 250, 0.6)'
                  : '2px solid rgba(74, 222, 128, 0.4)',
            }}
          >
            {seg.sourceText && seg.sourceText !== seg.translatedText && (
              <div className="text-[11px] text-white/40 leading-relaxed mb-1">
                {seg.sourceText}
              </div>
            )}
            <div className="flex items-start gap-2">
              <div
                className="flex-1 text-[15px] font-medium leading-snug"
                style={{
                  color: 'rgba(255,255,255,0.95)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.7)'
                }}
              >
                {seg.translatedText}
                {seg.status === 'partial' && (
                  <span className="inline-block w-1 h-4 bg-yellow-400/70 ml-1 animate-pulse rounded-sm" />
                )}
              </div>
              {seg.status === 'partial' && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 mt-1.5 animate-pulse shrink-0" />
              )}
              {seg.status === 'corrected' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400/80 mt-1.5 shrink-0" />
              )}
            </div>
          </div>
        ))}

        {segments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 opacity-30">
            <svg className="w-7 h-7 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="text-xs text-white/30">等待音频输入，字幕将在此显示</span>
          </div>
        )}
      </div>
    </div>
  )
}

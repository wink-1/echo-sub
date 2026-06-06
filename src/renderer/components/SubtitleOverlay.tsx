import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslationStore } from '../stores/translationStore'
import { AudioPCMProcessor } from './audio-processor'
import { SUBTITLE_CONFIG } from '../../shared/config'

export default function SubtitleOverlay(): JSX.Element {
  const { segments, clearSegments, isAsrOnly } = useTranslationStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // 控制状态
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [audioSource, setAudioSource] = useState<'none' | 'system' | 'microphone'>('none')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)

  const processorRef = useRef<AudioPCMProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelCtxRef = useRef<AudioContext | null>(null)
  const levelSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部（仅在 confirmed 段落更新时触发，避免 partial 频繁滚动）
  useEffect(() => {
    const lastSeg = segments[segments.length - 1]
    if (!lastSeg || lastSeg.status !== 'confirmed') return
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }, 50)
    return () => clearTimeout(timer)
  }, [segments])

  // 音频电平监测
  const startLevelMonitor = (stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    levelCtxRef.current = ctx
    levelSourceRef.current = source
    analyserRef.current = analyser
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      setAudioLevel(Math.min(avg / 128, 1))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const stopLevelMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (levelSourceRef.current) levelSourceRef.current.disconnect()
    if (analyserRef.current) analyserRef.current.disconnect()
    if (levelCtxRef.current) {
      levelCtxRef.current.close()
      levelCtxRef.current = null
    }
    levelSourceRef.current = null
    analyserRef.current = null
    setAudioLevel(0)
  }

  const handleLanguageChange = async (lang: string) => {
    setSourceLanguage(lang)
    await window.electronAPI?.updateSettings({ sourceLanguage: lang })
  }

  const startSystemAudio = async () => {
    setStatus('connecting')
    setErrorMsg('')

    // macOS: 提前检查屏幕录制权限
    const perm = await window.electronAPI?.checkScreenRecordPermission?.()
    if (perm && !perm.granted && perm.platform === 'darwin') {
      console.warn(
        '💡 macOS 屏幕录制权限未授予，系统音频捕获将不可用。请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许 EchoSub。将切换到麦克风模式。'
      )
    }

    let source: 'system' | 'microphone' = 'microphone'

    try {
      try {
        const sourceId = await window.electronAPI?.getSystemAudioSource()
        if (!sourceId) throw new Error('无可用音频源（系统未检测到屏幕）')

        console.log('[SubtitleOverlay] Got source ID:', sourceId)

        // 使用 Electron 31+ 兼容的约束格式（去掉 deprecated mandatory 包装）
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          } as MediaTrackConstraints,
          video: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1,
            maxWidth: 1,
            minHeight: 1,
            maxHeight: 1,
          } as MediaTrackConstraints,
        })

        const audioTracks = stream.getAudioTracks()
        const videoTracks = stream.getVideoTracks()
        videoTracks.forEach((t) => t.stop())

        console.log(
          `[SubtitleOverlay] Audio tracks: ${audioTracks.length}, Video tracks: ${videoTracks.length}`
        )
        if (audioTracks.length === 0) {
          // macOS 系统音频需要虚拟音频设备（如 BlackHole）
          const platform = window.electronAPI?.getPlatform?.() || ''
          const hint =
            platform === 'darwin'
              ? 'macOS 系统音频捕获需要安装虚拟音频驱动（如 BlackHole 或 Loopback），否则将自动切换到麦克风模式'
              : '未检测到系统音频轨道'
          throw new Error(hint)
        }

        source = 'system'
        streamRef.current = stream
      } catch (err) {
        console.warn('System audio failed, falling back to mic:', err)
        // 如果是 macOS 且提示需要 BlackHole，告知用户
        const platform = window.electronAPI?.getPlatform?.() || ''
        if (platform === 'darwin' && err instanceof Error && err.message.includes('BlackHole')) {
          console.warn(
            '💡 macOS 提示: 请安装 BlackHole (brew install blackhole-2ch)，然后在系统设置中将 BlackHole 设为多输出设备'
          )
        }

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        streamRef.current = micStream
      }

      setAudioSource(source)
      window.electronAPI?.reportAudioSource?.(source)

      startLevelMonitor(streamRef.current!)
      const processor = new AudioPCMProcessor()
      await processor.start(streamRef.current!)
      processorRef.current = processor

      const result = await window.electronAPI?.startCapture()
      if (result?.success !== false) {
        setIsCapturing(true)
        setStatus('running')
      }
    } catch (err) {
      console.error('Failed to start audio capture:', err)
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : '音频启动失败，请检查权限设置')
      // 清理已获取的资源
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      stopLevelMonitor()
      setIsCapturing(false)
    }
  }

  const stopCapture = async () => {
    processorRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    processorRef.current = null
    streamRef.current = null
    stopLevelMonitor()
    await window.electronAPI?.stopCapture()
    setIsCapturing(false)
    setStatus('idle')
    setErrorMsg('')
    setAudioSource('none')
  }

  const handleToggle = async () => {
    if (isCapturing) {
      await stopCapture()
    } else {
      await startSystemAudio()
    }
  }

  const handleToggleAlwaysOnTop = async () => {
    const result = await window.electronAPI?.toggleAlwaysOnTop()
    if (result) {
      setAlwaysOnTop(result.alwaysOnTop)
    }
  }

  // 拖拽 — 使用 document 级全局监听器，防止快速拖拽时移出标题栏导致中断
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastPos.current = { x: e.screenX, y: e.screenY }

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const deltaX = ev.screenX - lastPos.current.x
      const deltaY = ev.screenY - lastPos.current.y
      lastPos.current = { x: ev.screenX, y: ev.screenY }
      window.electronAPI?.subtitleDrag?.(deltaX, deltaY)
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const visibleSegments = segments.slice(-SUBTITLE_CONFIG.MAX_VISIBLE_SEGMENTS)

  return (
    <div
      className="w-full h-full select-none rounded-2xl flex flex-col"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.65) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        position: 'relative'
      }}
    >
      {/* 标题栏 - 可拖拽 */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-4 py-2.5 cursor-grab active:cursor-grabbing"
        role="toolbar"
        aria-label="字幕窗口工具栏"
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
            EchoSub
          </span>
          {isAsrOnly && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: 'rgba(250, 204, 21, 0.8)', background: 'rgba(250, 204, 21, 0.1)', border: '1px solid rgba(250, 204, 21, 0.2)' }}>
              ASR 测试
            </span>
          )}
          {isCapturing && (
            <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: 'rgba(74, 222, 128, 0.7)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'rgba(74, 222, 128, 0.8)' }} />
              {audioSource === 'system' ? '系统音频' : '麦克风'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-30 hover:opacity-60 transition-opacity">
          <button
            onClick={handleToggleAlwaysOnTop}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${alwaysOnTop ? 'text-blue-400' : 'text-white/40'}`}
            title={alwaysOnTop ? '取消置顶' : '始终置顶'}
            aria-label={alwaysOnTop ? '取消置顶' : '始终置顶'}
          >
            {alwaysOnTop ? '📌' : '📍'}
          </button>
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
          <div className="w-4 h-1 rounded-full bg-white/50" />
        </div>
      </div>

      {/* 控制栏 */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.2)'
        }}
      >
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-1.5 ${
            isCapturing
              ? 'bg-red-500/80 hover:bg-red-600 text-white'
              : 'bg-blue-500/80 hover:bg-blue-600 text-white'
          }`}
          style={{ minWidth: '90px', justifyContent: 'center' }}
          aria-label={isCapturing ? '停止翻译' : '开始翻译'}
        >
          {isCapturing ? (
            <>
              <span className="w-2.5 h-2.5 rounded-sm bg-white/80" />
              停止
            </>
          ) : (
            <>
              <span className="text-sm">▶</span>
              开始翻译
            </>
          )}
        </button>

        <select
          value={sourceLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          disabled={isCapturing}
          className="bg-white/5 text-white/80 text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-40"
          style={{ minWidth: '90px' }}
          aria-label="源语言"
        >
          <option value="auto" style={{ background: '#1a1a1a' }}>自动检测</option>
          <option value="en" style={{ background: '#1a1a1a' }}>English</option>
          <option value="ja" style={{ background: '#1a1a1a' }}>日本語</option>
          <option value="ko" style={{ background: '#1a1a1a' }}>한국어</option>
          <option value="zh" style={{ background: '#1a1a1a' }}>中文</option>
          <option value="fr" style={{ background: '#1a1a1a' }}>Français</option>
          <option value="de" style={{ background: '#1a1a1a' }}>Deutsch</option>
          <option value="es" style={{ background: '#1a1a1a' }}>Español</option>
          <option value="ru" style={{ background: '#1a1a1a' }}>Русский</option>
        </select>

        {isCapturing && (
          <div className="flex-1 flex items-center gap-1.5">
            <div className="flex-1 bg-white/10 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${Math.max(audioLevel * 100, 2)}%`,
                  background: audioLevel > 0.05
                    ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                    : 'rgba(255,255,255,0.1)'
                }}
              />
            </div>
            <span className={`text-[10px] font-medium ${audioLevel > 0.05 ? 'text-green-400/70' : 'text-white/20'}`}>
              {audioLevel > 0.05 ? '●' : '○'}
            </span>
          </div>
        )}

        {!isCapturing && segments.length > 0 && (
          <button
            onClick={clearSegments}
            className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-2 py-1 rounded hover:bg-white/5"
            aria-label="清空字幕"
          >
            清空
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div className="px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-[10px]" style={{ flexShrink: 0 }}>
          {errorMsg}
        </div>
      )}

      {/* 字幕滚动区 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 pt-1.5 space-y-1.5 scrollbar-hide"
        role="log"
        aria-live="polite"
        aria-label="翻译字幕"
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
            {seg.sourceText && seg.translatedText && seg.sourceText !== seg.translatedText && (
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
                {seg.translatedText || seg.sourceText}
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

        <div ref={bottomRef} style={{ height: 1 }} />

        {segments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 opacity-30">
            <svg className="w-7 h-7 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="text-xs text-white/30">点击「开始翻译」启动</span>
          </div>
        )}
      </div>
    </div>
  )
}

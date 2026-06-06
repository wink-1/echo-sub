import { useEffect, useRef, useState } from 'react'
import { SUBTITLE_CONFIG } from '../../shared/config'
import { useTranslationStore, ASR_LIVE_ID } from '../stores/translationStore'
import { AudioPCMProcessor } from './audio-processor'

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' }
]

function getAudioCaptureError(platform: string, audioTracks: number): string {
  if (platform === 'win32') {
    return audioTracks === 0
      ? '没有捕获到系统音频。请确认电脑正在播放声音，并重启 EchoSub 后再试。'
      : 'Windows 系统音频捕获失败。请检查显示器连接、远程桌面环境，或重启 EchoSub。'
  }

  if (platform === 'darwin') {
    return '没有捕获到系统音频。请重新开始，并在系统弹窗中勾选“分享音频”。'
  }

  return '当前版本暂不支持在 Linux 上捕获系统音频。'
}

export default function SubtitleOverlay(): JSX.Element {
  const { segments, clearSegments, isAsrOnly } = useTranslationStore()

  // 每当段落变化就自动滚到底部（partial / confirmed 都跟）
  useEffect(() => {
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }, 50)
    return () => clearTimeout(timer)
  }, [segments])

  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastResizeHeight = useRef(0)

  // 根据内容高度动态调整窗口大小，消除空白区域
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!scrollRef.current) return

      // 标题栏 (h-9=36) + 控制栏 (~40) + 错误提示 (~30 if present)
      const FIXED_BARS_HEIGHT = 76 + (errorMsg ? 30 : 0)
      // 滚动区内容实际高度（含 padding）
      const contentHeight = scrollRef.current.scrollHeight
      const desiredHeight = FIXED_BARS_HEIGHT + contentHeight + 8
      const clamped = Math.max(160, Math.min(desiredHeight, 280))

      // 仅在高度变化 >4px 时发送，避免抖动
      if (Math.abs(clamped - lastResizeHeight.current) > 4) {
        lastResizeHeight.current = clamped
        window.electronAPI?.resizeSubtitleWindow?.(clamped)
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [segments, errorMsg])

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

  const cleanupCapture = async () => {
    processorRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    processorRef.current = null
    streamRef.current = null
    stopLevelMonitor()
    await window.electronAPI?.stopCapture()
  }

  const handleLanguageChange = async (lang: string) => {
    setSourceLanguage(lang)
    await window.electronAPI?.updateSettings({ sourceLanguage: lang })
  }

  const captureSystemAudio = async (): Promise<MediaStream> => {
    const platform = window.electronAPI?.getPlatform?.() || ''

    if (platform === 'linux') {
      throw new Error('当前版本暂不支持在 Linux 上捕获系统音频。')
    }

    if (platform === 'darwin') {
      const perm = await window.electronAPI?.checkScreenRecordPermission?.()
      if (perm && !perm.granted) {
        throw new Error(
          '屏幕录制权限未授予。请前往“系统设置 > 隐私与安全性 > 屏幕录制”，允许 EchoSub 后重启应用。'
        )
      }
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: {
          width: { ideal: 1 },
          height: { ideal: 1 },
          frameRate: { ideal: 1 }
        } as MediaTrackConstraints
      })
    } catch (error) {
      if (platform === 'win32') {
        throw new Error('未检测到可用的屏幕源。请确认显示器已连接，或重启 EchoSub 后再试。')
      }
      throw error
    }

    const videoTracks = stream.getVideoTracks()
    const audioTracks = stream.getAudioTracks()
    videoTracks.forEach((track) => track.stop())

    console.log(
      `[EchoSub] getDisplayMedia: ${audioTracks.length} audio, ${videoTracks.length} video tracks`
    )

    if (audioTracks.length === 0) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error(getAudioCaptureError(platform, audioTracks.length))
    }

    window.electronAPI?.reportAudioSource?.(platform === 'win32' ? 'system-loopback' : 'display-media')
    return stream
  }

  const startCapturing = async () => {
    setStatus('connecting')
    setErrorMsg('')

    try {
      const stream = await captureSystemAudio()
      streamRef.current = stream

      const result = await window.electronAPI?.startCapture()
      if (result?.success === false) {
        throw new Error('后端捕获服务启动失败，请稍后重试。')
      }

      startLevelMonitor(stream)
      const processor = new AudioPCMProcessor()
      await processor.start(stream)
      processorRef.current = processor

      setIsCapturing(true)
      setStatus('running')
    } catch (err) {
      console.error('Failed to start system audio capture:', err)
      await cleanupCapture()
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : '系统音频捕获失败。')
      setIsCapturing(false)
    }
  }

  const stopCapture = async () => {
    await cleanupCapture()
    setIsCapturing(false)
    setStatus('idle')
    setErrorMsg('')
  }

  const handleToggle = async () => {
    if (isCapturing) {
      await stopCapture()
    } else {
      await startCapturing()
    }
  }

  const handleToggleAlwaysOnTop = async () => {
    const result = await window.electronAPI?.toggleAlwaysOnTop()
    if (result) {
      setAlwaysOnTop(result.alwaysOnTop)
    }
  }

  const visibleSegments = segments.slice(-SUBTITLE_CONFIG.MAX_VISIBLE_SEGMENTS)
  const statusText =
    status === 'running' ? '系统音频' : status === 'connecting' ? '连接中' : status === 'error' ? '异常' : '待机'

  return (
    <div className="flex h-full w-full select-none flex-col overflow-hidden rounded-lg border border-white/20 bg-neutral-950 text-white shadow-[0_8px_36px_rgba(0,0,0,0.6)]">
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b border-white/20 px-3 [-webkit-app-region:drag]"
        role="toolbar"
        aria-label="字幕窗口工具栏"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-white/80">EchoSub</span>
          {isAsrOnly && (
            <span className="rounded border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200/80">
              ASR 测试
            </span>
          )}
          <span className="flex items-center gap-1.5 text-[10px] text-white/60">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === 'running'
                  ? 'bg-emerald-400'
                  : status === 'connecting'
                    ? 'animate-pulse bg-sky-300'
                    : status === 'error'
                      ? 'bg-red-300'
                      : 'bg-white/40'
              }`}
            />
            {statusText}
          </span>
        </div>

        <button
          onClick={handleToggleAlwaysOnTop}
          className={`[-webkit-app-region:no-drag] h-6 rounded-md border px-2 text-[10px] transition ${
            alwaysOnTop
              ? 'border-sky-300/30 bg-sky-300/10 text-sky-100'
              : 'border-white/10 bg-white/5 text-white/45 hover:text-white/70'
          }`}
          title={alwaysOnTop ? '取消置顶' : '始终置顶'}
          aria-label={alwaysOnTop ? '取消置顶' : '始终置顶'}
        >
          置顶
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-white/20 bg-neutral-900 px-3 py-2">
        <button
          onClick={handleToggle}
          className={`flex h-7 w-[92px] items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition ${
            isCapturing
              ? 'bg-red-400/85 text-white hover:bg-red-400'
              : 'bg-sky-400/85 text-neutral-950 hover:bg-sky-300'
          }`}
          aria-label={isCapturing ? '停止' : isAsrOnly ? '开始识别' : '开始翻译'}
        >
          <span
            className={`block ${
              isCapturing ? 'h-2.5 w-2.5 rounded-sm bg-white/90' : 'h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current'
            }`}
          />
          {isCapturing ? '停止' : isAsrOnly ? '开始识别' : '开始翻译'}
        </button>

        <select
          value={sourceLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          disabled={isCapturing}
          className="h-7 max-w-[120px] rounded-md border border-white/20 bg-neutral-900 px-2 text-xs text-white/80 outline-none transition hover:border-white/30 disabled:opacity-40"
          aria-label="源语言"
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <option key={lang.value} value={lang.value} className="bg-neutral-900">
              {lang.label}
            </option>
          ))}
        </select>

        <div className="flex min-w-[84px] flex-1 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-emerald-300 transition-all duration-75"
              style={{
                width: `${isCapturing ? Math.max(audioLevel * 100, 3) : 0}%`,
                opacity: audioLevel > 0.04 ? 0.95 : 0.35
              }}
            />
          </div>
          <span className="w-8 text-right text-[10px] tabular-nums text-white/50">
            {isCapturing ? `${Math.round(audioLevel * 100)}%` : '--'}
          </span>
        </div>

        {!isCapturing && segments.length > 0 && (
          <button
            onClick={clearSegments}
            className="h-7 rounded-md border border-white/20 px-2 text-[10px] text-white/60 transition hover:bg-white/10 hover:text-white/90"
            aria-label="清空字幕"
          >
            清空
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="max-h-[60px] shrink-0 overflow-y-auto border-b border-red-300/20 bg-red-400/10 px-3 py-1 text-[11px] leading-5 text-red-100/90">
          {errorMsg}
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role="log"
        aria-live="polite"
        aria-label="翻译字幕"
      >
        {visibleSegments.length === 0 ? (
          <div className="flex h-[80px] items-center justify-center text-xs text-white/50">
            点击“{isAsrOnly ? '开始识别' : '开始翻译'}”启动
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleSegments.map((seg) => (
              <div
                key={seg.id}
                className="animate-fadeIn border-b border-white/10 px-1 pb-2 last:border-b-0"
              >
                {seg.sourceText && seg.translatedText && seg.sourceText !== seg.translatedText && (
                  <div className="mb-0.5 break-words text-[11px] leading-relaxed text-white/60">{seg.sourceText}</div>
                )}
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                      seg.id === ASR_LIVE_ID
                        ? 'animate-pulse bg-sky-300'
                        : seg.status === 'partial'
                          ? 'animate-pulse bg-amber-300'
                          : seg.status === 'corrected'
                            ? 'bg-sky-300'
                            : 'bg-emerald-300/80'
                    }`}
                  />
                  <div className="min-w-0 flex-1 break-words text-[15px] font-medium leading-snug text-white/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.65)]">
                    {seg.id === ASR_LIVE_ID
                      ? <span className="text-white/50">{seg.sourceText}<span className="ml-1 inline-block h-3 w-0.5 animate-pulse rounded-sm bg-sky-300/60" /></span>
                      : seg.translatedText
                        ? seg.translatedText
                        : <span className="text-white/50">{seg.sourceText}<span className="ml-1.5 text-[11px] text-amber-200/60">翻译中…</span></span>
                    }
                    {seg.id !== ASR_LIVE_ID && seg.status === 'partial' && seg.translatedText && (
                      <span className="ml-1 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse rounded-sm bg-amber-300/80" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={bottomRef} className="h-px" />
      </div>
    </div>
  )
}

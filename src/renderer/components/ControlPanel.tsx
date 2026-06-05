import { useState, useRef, useEffect } from 'react'

// PCM 音频处理器 - 将 MediaStream 转换为 16kHz 16bit PCM 并发送到主进程
class AudioPCMProcessor {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private targetSampleRate = 16000

  async start(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate })
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)

    // 使用 ScriptProcessorNode 将音频转为 PCM
    // bufferSize=4096 约 256ms @ 16kHz
    this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1)

    this.scriptNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      // float32 → int16 PCM
      const pcm16 = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      // IPC 传输: ArrayBuffer 在 IPC 中可能丢失, 用 Uint8Array 包装
      // 用 slice 创建独立副本 (避免底层 buffer 被复用)
      const bytes = new Uint8Array(pcm16.buffer.slice(0))
      window.electronAPI?.sendAudioPCMData(bytes)
    }

    this.sourceNode.connect(this.scriptNode)
    this.scriptNode.connect(this.audioContext.destination)
  }

  stop(): void {
    this.scriptNode?.disconnect()
    this.sourceNode?.disconnect()
    this.audioContext?.close()
    this.audioContext = null
    this.sourceNode = null
    this.scriptNode = null
  }
}

export default function ControlPanel(): JSX.Element {
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioSource, setAudioSource] = useState<'none' | 'system' | 'microphone'>('none')
  const processorRef = useRef<AudioPCMProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // 检查音频电平 (用于 UI 反馈)
  const [audioLevel, setAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  const startLevelMonitor = (stream: MediaStream) => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      setAudioLevel(Math.min(avg / 128, 1)) // normalize 0-1
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const stopLevelMonitor = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    analyserRef.current = null
    setAudioLevel(0)
  }

  const handleToggle = async () => {
    if (isCapturing) {
      // 停止
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
    } else {
      // 开始
      setStatus('connecting')
      setErrorMsg('')

      try {
        let stream: MediaStream
        let source: 'system' | 'microphone' = 'microphone'

        // 尝试使用系统音频 (桌面音频捕获)
        try {
          const sourceId = await window.electronAPI?.getSystemAudioSource()
          if (sourceId) {
            // 注意: chromeMediaSource: 'desktop' 同时需要 audio 和 video
            // 然后丢弃 video track
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              } as unknown as MediaTrackConstraints,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                  maxWidth: 1,
                  maxHeight: 1
                }
              } as unknown as MediaTrackConstraints
            })
            // 丢弃 video track, 只保留 audio
            stream.getVideoTracks().forEach(t => t.stop())
            stream.removeTrack(stream.getVideoTracks()[0])

            if (stream.getAudioTracks().length > 0) {
              source = 'system'
              console.log('System audio captured via desktopCapturer')
            } else {
              throw new Error('No audio track in desktop capture')
            }
          } else {
            throw new Error('No system audio source available')
          }
        } catch (loopbackErr) {
          console.warn('System audio capture failed:', loopbackErr)
          console.log('Falling back to microphone...')
          // 降级到麦克风输入
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true
            }
          })
          console.log('Microphone captured')
        }

        streamRef.current = stream
        setAudioSource(source)

        // 启动音频电平监测
        startLevelMonitor(stream)

        // 创建 PCM 处理器并发送音频
        const processor = new AudioPCMProcessor()
        await processor.start(stream)
        processorRef.current = processor

        // 通知主进程后端开始接收音频
        const result = await window.electronAPI?.startCapture()
        if (result?.success !== false) {
          setIsCapturing(true)
          setStatus('running')
        } else {
          setStatus('error')
          setErrorMsg('启动失败')
        }
      } catch (err) {
        console.error('Audio capture error:', err)
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">控制面板</h2>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'running'
                ? 'bg-green-500 animate-pulse'
                : status === 'error'
                  ? 'bg-red-500'
                  : status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-gray-500'
            }`}
          />
          <span className="text-xs text-gray-400">
            {status === 'idle' && '待机'}
            {status === 'connecting' && '连接中...'}
            {status === 'running' && '运行中'}
            {status === 'error' && '错误'}
          </span>
        </div>
      </div>

      <button
        onClick={handleToggle}
        className={`w-full py-2 rounded-md font-medium text-sm transition-colors ${
          isCapturing
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {isCapturing ? '⏹ 停止翻译' : '▶ 开始翻译'}
      </button>

      {/* 音频电平指示器 */}
      {isCapturing && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {audioSource === 'system' ? '🔊 系统音频' : '🎤 麦克风'}
            </span>
            <span className={`text-gray-400 ${audioLevel > 0.05 ? 'text-green-400' : 'text-red-400'}`}>
              {audioLevel > 0.05 ? '检测到音频' : '未检测到音频'}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-100"
              style={{
                width: `${Math.max(audioLevel * 100, 2)}%`,
                backgroundColor: audioLevel > 0.05 ? '#22c55e' : '#6b7280'
              }}
            />
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-900/50 text-red-300 text-xs p-2 rounded">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-700 rounded p-2">
          <div className="text-gray-400">源语言</div>
          <div className="text-white font-medium">自动检测</div>
        </div>
        <div className="bg-gray-700 rounded p-2">
          <div className="text-gray-400">目标语言</div>
          <div className="text-white font-medium">中文</div>
        </div>
      </div>
    </div>
  )
}

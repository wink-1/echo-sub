import { useState, useRef } from 'react'

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
      // 发送到主进程 → Python 后端
      window.electronAPI?.sendAudioPCMData(pcm16.buffer)
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
  const processorRef = useRef<AudioPCMProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const handleToggle = async () => {
    if (isCapturing) {
      // 停止
      processorRef.current?.stop()
      streamRef.current?.getTracks().forEach(t => t.stop())
      processorRef.current = null
      streamRef.current = null
      await window.electronAPI?.stopCapture()
      setIsCapturing(false)
      setStatus('idle')
      setErrorMsg('')
    } else {
      // 开始
      setStatus('connecting')
      setErrorMsg('')

      try {
        let stream: MediaStream

        // 尝试使用系统音频 (桌面音频捕获)
        try {
          const sourceId = await window.electronAPI?.getSystemAudioSource()
          if (sourceId) {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              } as unknown as MediaTrackConstraints,
              video: false
            })
            console.log('System audio captured via desktopCapturer')
          } else {
            throw new Error('No system audio source available')
          }
        } catch (loopbackErr) {
          console.warn('System audio capture failed:', loopbackErr)
          // 降级到麦克风输入
          console.log('Falling back to microphone...')
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

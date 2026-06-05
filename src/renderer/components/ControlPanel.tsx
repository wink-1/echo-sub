import { useState } from 'react'

export default function ControlPanel(): JSX.Element {
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'error'>('idle')

  const handleToggle = async () => {
    if (isCapturing) {
      await window.electronAPI?.stopCapture()
      setIsCapturing(false)
      setStatus('idle')
    } else {
      setStatus('connecting')
      const result = await window.electronAPI?.startCapture()
      if (result?.success) {
        setIsCapturing(true)
        setStatus('running')
      } else {
        setStatus('error')
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

# EchoSub - AI同声传译助手

实时捕获电脑正在播放的外语音频，翻译成中文字幕悬浮显示，并具备自动纠错能力。

## ✨ 特性

- 🎙️ **系统音频捕获** - 直接捕获电脑播放的音频，无需麦克风
- 🔄 **实时ASR识别** - 基于 faster-whisper 的高精度语音转文字
- 🌐 **实时翻译** - 基于 Ollama + Qwen2.5 的本地翻译，零费用
- ✏️ **自动纠错** - 三层纠错机制：流式→确认→上下文修正
- 📺 **悬浮字幕** - 透明置顶字幕窗口，不影响正常使用
- 🔤 **双语显示** - 支持仅中文/双语对照模式
- 💰 **完全免费** - 所有AI处理均在本地运行，无需API费用

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron 31+ |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 构建工具 | Vite + electron-vite |
| 音频捕获 | electron-audio-loopback |
| ASR引擎 | faster-whisper (CTranslate2) |
| 翻译+纠错 | Ollama + Qwen2.5:7b |
| 后端通信 | FastAPI + WebSocket |

## 📋 系统要求

- **Node.js** 18+
- **Python** 3.10+
- **Ollama** (自动安装)
- **GPU** (推荐, NVIDIA 8GB+ 或 Mac M芯片)
- **内存** 16GB+ (推荐)
- **磁盘** ~7GB (Whisper模型 + Qwen2.5模型)

## 🚀 快速开始

### 一键安装

```bash
git clone https://github.com/YOUR_USERNAME/echo-sub.git
cd echo-sub
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 手动安装

1. **安装 Ollama 并下载模型**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull qwen2.5:7b
   ```

2. **安装前端依赖**
   ```bash
   npm install
   ```

3. **安装 Python 后端依赖**
   ```bash
   pip3 install -r backend/requirements.txt
   ```

4. **启动应用**
   ```bash
   npm run dev
   ```

## 🏗️ 项目结构

```
echo-sub/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 入口
│   │   ├── audio-capture.ts  # 音频捕获
│   │   ├── python-bridge.ts  # Python后端桥接
│   │   ├── subtitle-window.ts# 字幕窗口
│   │   └── ipc-handlers.ts   # IPC通信
│   ├── renderer/             # React 渲染进程
│   │   ├── components/       # UI组件
│   │   └── stores/           # 状态管理
│   ├── shared/               # 共享类型
│   └── preload/              # preload脚本
├── backend/                  # Python 后端
│   ├── server.py             # FastAPI WebSocket服务器
│   ├── asr.py                # ASR引擎
│   ├── translator.py         # 翻译模块
│   └── corrector.py          # 纠错模块
└── scripts/                  # 工具脚本
```

## 🎯 三层纠错机制

```
第一层: 流式delta → 实时显示 (半透明文字)
第二层: 段落确认 → VAD检测句子结束 (实心文字)
第三层: 上下文纠错 → Qwen2.5带上下文重翻 (高亮修正)
```

## 📝 使用说明

1. 启动应用后，确保 Ollama 服务正在运行
2. 点击「开始翻译」按钮
3. 授予系统音频录制权限（macOS需要屏幕录制权限）
4. 播放外语音频，字幕将实时显示在屏幕上方
5. 可以拖拽字幕窗口调整位置

## ⚠️ 注意事项

- **macOS**: 系统音频捕获需要屏幕录制权限，在系统设置中授予
- **Windows**: 需要安装 Visual C++ Redistributable
- **首次运行**: Whisper模型会自动下载（约1.5GB），请耐心等待
- **GPU**: 有独立显卡体验最佳，无GPU也可运行但延迟较高

## 📄 License

MIT

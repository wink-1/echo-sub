# EchoSub - AI同声传译助手

实时捕获电脑正在播放的外语音频，翻译成中文字幕悬浮显示，并具备自动纠错能力。

## ✨ 特性

- 🎙️ **系统音频捕获** - 直接捕获电脑播放的音频（macOS 使用 ScreenCaptureKit / Windows 使用 desktopCapturer）
- 🔄 **实时ASR识别** - 基于 faster-whisper 的高精度语音转文字
- 🌐 **实时翻译** - 基于 DeepSeek API 的云端翻译，高质量低成本
- ✏️ **自动纠错** - 三层纠错机制：流式→确认→上下文修正
- 📺 **悬浮字幕** - 透明置顶字幕窗口，不影响正常使用
- 🔤 **双语显示** - 支持原文/译文双语对照显示
- 🧪 **ASR 测试模式** - 不调用 API，仅验证语音识别质量（零费用）
- 💰 **低成本** - 本地 ASR 免费，DeepSeek API 按量计费（约 1元/百万token）

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron 31+ |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 构建工具 | Vite + electron-vite |
| 代码规范 | ESLint + Prettier + EditorConfig |
| CI/CD | GitHub Actions |
| 音频捕获 | macOS: getDisplayMedia (ScreenCaptureKit) / Windows: desktopCapturer |
| ASR引擎 | faster-whisper (CTranslate2) |
| 翻译+纠错 | DeepSeek Chat API |
| 后端通信 | FastAPI + WebSocket |

## 📋 系统要求

- **Node.js** 18+
- **Python** 3.10+
- **GPU** (推荐, NVIDIA 8GB+ 或 Mac M芯片)
- **内存** 8GB+ (推荐)
- **磁盘** ~500MB (Whisper small 模型 ~244MB + 依赖)
- **DeepSeek API Key** — 仅翻译模式需要，[免费注册获取](https://platform.deepseek.com/api_keys)

## 🚀 快速开始

### 一键安装

```bash
git clone https://github.com/wink-1/echo-sub.git
cd echo-sub
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 手动安装

1. **克隆项目并安装前端依赖**
   ```bash
   git clone https://github.com/wink-1/echo-sub.git
   cd echo-sub
   npm install
   ```

2. **创建 Python 虚拟环境并安装后端依赖**
   ```bash
   python3 -m venv backend/venv
   source backend/venv/bin/activate
   pip install -r backend/requirements.txt
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件
   ```

4. **启动应用**
   ```bash
   npm run dev
   ```

## 🧪 ASR 测试模式（推荐首次使用）

如果你想先验证语音识别效果，不调用翻译 API：

1. 编辑 `.env` 文件，添加：
   ```bash
   ASR_ONLY=true
   ```

2. 启动应用，标题栏会显示 **「ASR 测试」** 黄色标签
3. 此时 DeepSeek API 不会被调用（无需 API Key），仅显示识别的原文
4. 确认识别效果满意后，删除 `ASR_ONLY=true` 恢复完整翻译模式

## 🏗️ 项目结构

```
echo-sub/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 入口, IPC, 托盘
│   │   ├── audio-capture.ts  # 音频转发
│   │   ├── python-bridge.ts  # Python后端桥接
│   │   ├── subtitle-window.ts# 字幕窗口
│   │   └── ipc-handlers.ts   # IPC通信
│   ├── renderer/             # React 渲染进程
│   │   ├── components/       # UI组件 (SubtitleOverlay, ErrorBoundary)
│   │   └── stores/           # Zustand 状态管理
│   ├── shared/               # 共享类型 + 配置常量 (types.ts, config.ts)
│   └── preload/              # preload脚本
├── backend/                  # Python 后端
│   ├── server.py             # FastAPI WebSocket服务器
│   ├── asr.py                # ASR引擎 (faster-whisper)
│   ├── translator.py         # 翻译模块 (DeepSeek)
│   └── corrector.py          # 纠错模块
├── .github/workflows/        # CI/CD (lint + typecheck + test)
└── scripts/                  # 工具脚本
```

## 🎯 三层纠错机制

```
第一层: 流式delta → 实时显示 (半透明文字 + 黄色指示)
第二层: 段落确认 → VAD检测句子结束 (实心文字 + 绿色指示)
第三层: 上下文纠错 → DeepSeek 带上下文重翻 (蓝色高亮修正)
```

## 📝 使用说明

1. 启动应用后，字幕悬浮窗会自动出现在屏幕底部
2. 在控制栏选择源语言（auto 自动检测）
3. 点击「开始翻译」（ASR 测试模式显示「开始识别」）
4. **macOS**：系统弹出分享对话框，**务必勾选底部的「分享音频」复选框**，然后选择屏幕
5. **Windows**：自动捕获系统音频，无需额外操作
6. 播放外语音频，字幕将实时显示
7. 可以拖拽标题栏调整窗口位置

## 💻 开发

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
npm test             # 前端测试
npm run test:python  # 后端测试
```

## ⚠️ 注意事项

- **macOS 系统音频**: 首次使用会弹出 `getDisplayMedia` 对话框，需勾选「分享音频」才会捕获系统声音。不会申请麦克风权限。
- **macOS 权限**: 需要「屏幕录制」权限（系统设置 → 隐私与安全性 → 屏幕录制）
- **Windows**: 系统音频原生支持，需要安装 Visual C++ Redistributable
- **首次运行**: Whisper 模型会自动下载（约 244MB），请耐心等待
- **GPU**: 有独立显卡体验最佳，M 芯片使用 Metal 加速，无 GPU 也可运行但延迟较高
- **ASR 测试模式**: 设置 `ASR_ONLY=true` 可在不消耗 API 费用的情况下验证识别效果

## 📄 License

MIT

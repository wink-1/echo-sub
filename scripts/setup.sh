#!/bin/bash
# EchoSub 一键安装脚本
# 支持 macOS, Linux, Windows (Git Bash)

set -e

echo "====================================="
echo "  EchoSub - AI同声传译助手 安装脚本"
echo "====================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 平台检测
IS_WINDOWS=false
case "$(uname -s)" in
    CYGWIN*|MINGW*|MSYS*) IS_WINDOWS=true ;;
esac

# 检查命令是否存在
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 已安装"
        return 0
    else
        echo -e "${RED}✗${NC} $1 未安装"
        return 1
    fi
}

# 1. 检查 Node.js
echo ">>> 检查 Node.js..."
if ! check_command node; then
    echo -e "${YELLOW}请先安装 Node.js 18+: https://nodejs.org${NC}"
    exit 1
fi

# 2. 检查 Python
echo ">>> 检查 Python..."
PYTHON_CMD="python3"
if $IS_WINDOWS; then
    PYTHON_CMD="python"
fi
if ! check_command "$PYTHON_CMD"; then
    echo -e "${YELLOW}请先安装 Python 3.10+: https://python.org${NC}"
    exit 1
fi

# 3. 安装 npm 依赖
echo ""
echo ">>> 安装 npm 依赖..."
npm install
echo -e "${GREEN}✓${NC} npm 依赖安装完成"

# 4. 创建 Python 虚拟环境
echo ""
echo ">>> 创建 Python 虚拟环境..."
if [ ! -d "backend/venv" ]; then
    $PYTHON_CMD -m venv backend/venv
    echo -e "${GREEN}✓${NC} Python 虚拟环境创建完成"
else
    echo -e "${GREEN}✓${NC} Python 虚拟环境已存在"
fi

# venv pip 路径
if $IS_WINDOWS; then
    VENV_PIP="backend/venv/Scripts/pip"
else
    VENV_PIP="backend/venv/bin/pip"
fi

# 5. 安装 Python 依赖 (在 venv 中)
echo ""
echo ">>> 安装 Python 依赖..."
$VENV_PIP install -r backend/requirements.txt
echo -e "${GREEN}✓${NC} Python 依赖安装完成"

# 6. 复制环境变量模板
echo ""
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} 已创建 .env 配置文件"
    echo ""
    echo -e "${YELLOW}💡 提示:${NC}"
    echo "  - 首次使用建议开启 ASR 测试模式（不消耗 API 费用）"
    echo "    编辑 .env 文件，取消 ASR_ONLY=true 的注释即可"
    echo "  - 确认识别效果后，填入 DeepSeek API Key 并删除 ASR_ONLY 行"
    echo "    获取地址: https://platform.deepseek.com/api_keys"
else
    echo -e "${GREEN}✓${NC} .env 已存在"
fi

echo ""
echo "====================================="
echo -e "${GREEN}安装完成!${NC}"
echo ""
echo "运行以下命令启动应用:"
echo "  npm run dev"
echo ""
echo "首次启动:"
echo "  1. Whisper 模型会自动下载 (~244MB)"
echo "  2. macOS 点击开始时需在弹出对话框中勾选「分享音频」"
echo "  3. 标题栏显示「ASR 测试」表示仅识别模式，零 API 消耗"
echo ""
echo "开发命令:"
echo "  npm run lint      # 代码检查"
echo "  npm test          # 运行测试"
echo "  npm run test:python  # 后端测试"
echo "====================================="

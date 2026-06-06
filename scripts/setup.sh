#!/bin/bash
# EchoSub 一键安装脚本

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
if ! check_command python3; then
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
    python3 -m venv backend/venv
    echo -e "${GREEN}✓${NC} Python 虚拟环境创建完成"
else
    echo -e "${GREEN}✓${NC} Python 虚拟环境已存在"
fi

# 5. 安装 Python 依赖 (在 venv 中)
echo ""
echo ">>> 安装 Python 依赖..."
backend/venv/bin/pip install -r backend/requirements.txt
echo -e "${GREEN}✓${NC} Python 依赖安装完成"

# 6. 复制环境变量模板
echo ""
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} 已创建 .env 配置文件"
    echo ""
    echo -e "${YELLOW}⚠️  重要: 请编辑 .env 文件，填入你的 DeepSeek API Key${NC}"
    echo "   获取地址: https://platform.deepseek.com/api_keys"
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
echo "首次启动时, Whisper 模型会自动下载 (~244MB)"
echo "请确保已配置 DeepSeek API Key (.env 文件)"
echo "====================================="

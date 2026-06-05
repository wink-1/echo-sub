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

# 4. 安装 Python 依赖
echo ""
echo ">>> 安装 Python 依赖..."
pip3 install -r backend/requirements.txt
echo -e "${GREEN}✓${NC} Python 依赖安装完成"

# 5. 检查/安装 Ollama
echo ""
echo ">>> 检查 Ollama..."
if ! check_command ollama; then
    echo -e "${YELLOW}正在安装 Ollama...${NC}"
    curl -fsSL https://ollama.com/install.sh | sh
    echo -e "${GREEN}✓${NC} Ollama 安装完成"
else
    echo -e "${GREEN}✓${NC} Ollama 已安装"
fi

# 6. 启动 Ollama 服务 (如果没有运行)
echo ""
echo ">>> 启动 Ollama 服务..."
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    ollama serve &
    sleep 3
    echo -e "${GREEN}✓${NC} Ollama 服务已启动"
else
    echo -e "${GREEN}✓${NC} Ollama 服务已在运行"
fi

# 7. 下载翻译模型
echo ""
echo ">>> 下载 Qwen2.5:7b 翻译模型 (约4.7GB)..."
ollama pull qwen2.5:7b
echo -e "${GREEN}✓${NC} 翻译模型下载完成"

# 8. 复制环境变量模板
echo ""
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} 已创建 .env 配置文件"
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
echo "首次运行时,Whisper 模型会自动下载 (~1.5GB)"
echo "====================================="

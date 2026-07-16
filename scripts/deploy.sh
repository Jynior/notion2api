#!/bin/bash
# ==========================================
# Notion-AI Docker 部署脚本
# ==========================================

set -e  # Exit immediately on error

echo "=========================================="
echo "  Notion-AI Docker deploy script"
echo "=========================================="

# Check whether Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

# Check whether Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi

# 检查 .env 文件是否存在
if [ ! -f .env ]; then
    echo "⚠️  .env missing; creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env file"
        echo "📝 Edit .env and fill in your Notion account details"
        echo "   Edit it, then re-run this script"
        exit 0
    else
        echo "❌ .env.example not found"
        exit 1
    fi
fi

# 创建必要的目录
echo "📁 Creating data directory..."
mkdir -p data logs

# 构建镜像
echo "🔨 Building Docker image..."
docker-compose build --no-cache

# 启动服务
echo "🚀 Starting service..."
docker-compose up -d

# etc待服务启动
echo "⏳ Waiting for service..."
sleep 5

# 检查服务状态
echo ""
echo "📊 Service status:"
docker-compose ps

# 检查健康状态
echo ""
echo "🏥 Health check:"
if curl -s http://localhost:8000/health > /dev/null; then
    echo "✅ Service is healthy!"
    echo ""
    echo "🌐 URL:"
    echo "   - Web UI: http://localhost:8000"
    echo "   - API docs: http://localhost:8000/docs"
    echo "   - Health: http://localhost:8000/health"
    echo ""
    echo "📝 View logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "🛑 Stop service:"
    echo "   docker-compose down"
else
    echo "❌ Service failed to start; check logs:"
    echo "   docker-compose logs"
fi

echo ""
echo "=========================================="
echo "  Deploy complete!"
echo "=========================================="

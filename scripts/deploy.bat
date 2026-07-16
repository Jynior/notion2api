@echo off
REM ==========================================
REM Notion-AI Docker Deploy script (Windows)
REM ==========================================

echo ==========================================
echo   Notion-AI Docker deploy script
echo ==========================================
echo.

REM Check whether Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not installed Desktop
    pause
    exit /b 1
)

REM 检查 .env 文件是否存在
if not exist .env (
    echo ⚠️  .env missing; creating from .env.example...
    if exist .env.example (
        copy .env.example .env >nul
        echo ✅ Created .env file
        echo 📝 Edit .env and fill in your Notion account details
        echo    Edit it, then re-run this script
        pause
        exit /b 0
    ) else (
        echo ❌ .env.example not found
        pause
        exit /b 1
    )
)

REM 创建必要的目录
echo 📁 Creating data directory...
if not exist data mkdir data
if not exist logs mkdir logs

REM 构建镜像
echo 🔨 Building Docker image...
docker-compose build --no-cache

REM 启动服务
echo 🚀 Starting service...
docker-compose up -d

REM etc待服务启动
echo ⏳ Waiting for service...
timeout /t 5 /nobreak >nul

REM 检查服务状态
echo.
echo 📊 Service status:
docker-compose ps

REM 检查健康状态
echo.
echo 🏥 Health check:
curl -s http://localhost:8000/health >nul 2>&1
if errorlevel 1 (
    echo ❌ Service failed to start; check logs:
    echo    docker-compose logs
) else (
    echo ✅ Service is healthy!
    echo.
    echo 🌐 URL:
    echo    - Web UI: http://localhost:8000
    echo    - API docs: http://localhost:8000/docs
    echo    - Health: http://localhost:8000/health
    echo.
    echo 📝 View logs:
    echo    docker-compose logs -f
    echo.
    echo 🛑 Stop service:
    echo    docker-compose down
)

echo.
echo ==========================================
echo   Deploy complete!
echo ==========================================
pause

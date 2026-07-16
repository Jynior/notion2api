#!/bin/bash
# ==========================================
# Notion-AI 服务管理脚本
# ==========================================

case "$1" in
    start)
        echo "🚀 Starting service..."
        docker-compose up -d
        ;;
    stop)
        echo "🛑 Stopping service..."
        docker-compose down
        ;;
    restart)
        echo "🔄 Restarting service..."
        docker-compose restart
        ;;
    status)
        echo "📊 Service status:"
        docker-compose ps
        echo ""
        echo "🏥 Health check:"
        curl -s http://localhost:8000/health | jq . 2>/dev/null || curl -s http://localhost:8000/health
        ;;
    logs)
        echo "📝 Logs (Ctrl+C to exit):"
        docker-compose logs -f
        ;;
    build)
        echo "🔨 Rebuilding image..."
        docker-compose build --no-cache
        ;;
    update)
        echo "🔄 Updating and restarting..."
        docker-compose down
        docker-compose build --no-cache
        docker-compose up -d
        ;;
    clean)
        echo "🧹 Cleaning containers and images..."
        docker-compose down -v
        docker system prune -f
        ;;
    backup)
        echo "💾 Backing up database..."
        BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp data/conversations.db "$BACKUP_DIR/"
        echo "✅ Backup done: $BACKUP_DIR"
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "❌ Specify a backup dir, e.g. ./manage.sh restore backups/20240306_120000"
            exit 1
        fi
        echo "📥 Restoring database..."
        cp "$2/conversations.db" data/
        echo "✅ Restore complete; restart: ./manage.sh restart"
        ;;
    shell)
        echo "🐚 Opening container shell..."
        docker-compose exec notion-opus /bin/bash
        ;;
    test)
        echo "🧪 Testing API..."
        echo "Sending test request..."
        curl -X POST http://localhost:8000/v1/chat/completions \
            -H "Content-Type: application/json" \
            -d '{
                "model": "claude-opus4.6",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": false
            }'
        ;;
    *)
        echo "=========================================="
        echo "  Notion-AI service management script"
        echo "=========================================="
        echo "Usage: ./manage.sh {command}"
        echo ""
        echo "Commands:"
        echo "  start     - start service"
        echo "  stop      - stop service"
        echo "  restart   - restart service"
        echo "  status    - status"
        echo "  logs      - view logs"
        echo "  build     - rebuild image"
        echo "  update    - update and restart"
        echo "  clean     - remove containers/images"
        echo "  backup    - backup database"
        echo "  restore   - restore database (needs backup dir)"
        echo "  shell     - container shell"
        echo "  test      - test API"
        echo ""
        echo "Examples:"
        echo "  ./manage.sh start"
        echo "  ./manage.sh logs"
        echo "  ./manage.sh backup"
        echo "  ./manage.sh restore backups/20240306_120000"
        echo "=========================================="
        exit 1
        ;;
esac

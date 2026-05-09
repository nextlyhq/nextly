#!/bin/bash

# Nextly - Docker Development Helper
# Manages Docker Compose services for local development

set -e

# ═══════════════════════════════════════════════
# Colors for Output
# ═══════════════════════════════════════════════
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════
# Environment Variables
# ═══════════════════════════════════════════════
# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    # Export variables from .env file (simple parsing)
    set -a
    source <(grep -v '^#' "$PROJECT_ROOT/.env" | grep -v '^$')
    set +a
fi

# Database configuration with fallback defaults
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-nextly_dev}"
DB_PORT="${DB_PORT:-5432}"
ADMINER_PORT="${ADMINER_PORT:-8080}"

# ═══════════════════════════════════════════════
# Docker Compose Command Detection
# ═══════════════════════════════════════════════
if command -v docker &> /dev/null && docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED}[ERROR]${NC} Neither 'docker compose' nor 'docker-compose' found"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# ═══════════════════════════════════════════════
# Logging Functions
# ═══════════════════════════════════════════════
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

# ═══════════════════════════════════════════════
# Command Router
# ═══════════════════════════════════════════════
case "$1" in
    up)
        log_info "Starting Nextly development environment..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE up -d
        log_info "Waiting for services to be healthy..."
        sleep 2
        $DOCKER_COMPOSE ps
        echo ""
        log_success "Services started successfully!"
        echo ""
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}📊 Access Points:${NC}"
        echo -e "  ${BLUE}PostgreSQL:${NC} localhost:${DB_PORT}"
        echo -e "  ${BLUE}Adminer UI:${NC} http://localhost:${ADMINER_PORT}"
        echo -e "  ${BLUE}Database:${NC} ${DB_NAME}"
        echo -e "  ${BLUE}User:${NC} ${DB_USER}"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        log_info "Use 'pnpm docker:logs' to view service logs"
        log_info "Use 'pnpm docker:shell' to open PostgreSQL shell"
        ;;

    down)
        log_info "Stopping Nextly development environment..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE down
        log_success "Services stopped!"
        ;;

    restart)
        log_info "Restarting Nextly development environment..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE restart
        log_success "Services restarted!"
        ;;

    logs)
        cd "$PROJECT_ROOT"
        if [ -z "$2" ]; then
            log_info "Showing logs for all services (Ctrl+C to exit)..."
            $DOCKER_COMPOSE logs -f
        else
            log_info "Showing logs for '$2' (Ctrl+C to exit)..."
            $DOCKER_COMPOSE logs -f "$2"
        fi
        ;;

    reset)
        echo ""
        log_warn "⚠️  WARNING: This will delete ALL data in the database!"
        log_warn "This action cannot be undone."
        echo ""
        read -p "Are you sure you want to reset? (type 'yes' to confirm): " response
        if [[ "$response" == "yes" ]]; then
            log_info "Resetting development environment..."
            cd "$PROJECT_ROOT"
            $DOCKER_COMPOSE down -v
            log_success "Environment reset complete!"
            log_info "All data has been deleted."
            log_info "Run 'pnpm docker:up' to start fresh."
        else
            log_info "Reset cancelled."
        fi
        ;;

    backup)
        BACKUP_DIR="$PROJECT_ROOT/backups"
        BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).sql"
        mkdir -p "$BACKUP_DIR"
        log_info "Creating database backup..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log_success "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"
        ;;

    restore)
        if [ -z "$2" ]; then
            log_error "Usage: $0 restore <backup-file>"
            echo ""
            echo "Available backups:"
            ls -lh "$PROJECT_ROOT/backups"/*.sql 2>/dev/null || echo "  No backups found in backups/"
            exit 1
        fi
        if [ ! -f "$2" ]; then
            log_error "Backup file not found: $2"
            exit 1
        fi
        log_info "Restoring database from $2..."
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE exec -T postgres psql -U "$DB_USER" "$DB_NAME" < "$2"
        log_success "Database restored successfully!"
        ;;

    shell)
        log_info "Opening PostgreSQL shell..."
        echo ""
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}PostgreSQL Shell${NC}"
        echo -e "  Database: ${DB_NAME}"
        echo -e "  User: ${DB_USER}"
        echo ""
        echo -e "${YELLOW}Useful commands:${NC}"
        echo -e "  \\l          List databases"
        echo -e "  \\dt         List tables"
        echo -e "  \\dx         List extensions"
        echo -e "  \\q          Quit"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE exec postgres psql -U "$DB_USER" "$DB_NAME"
        ;;

    test)
        log_info "Testing database connection..."
        cd "$PROJECT_ROOT"
        if $DOCKER_COMPOSE exec postgres pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
            log_success "Database connection successful!"
            echo ""
            echo -e "${BLUE}Connection Details:${NC}"
            echo -e "  Host: localhost"
            echo -e "  Port: ${DB_PORT}"
            echo -e "  Database: ${DB_NAME}"
            echo -e "  User: ${DB_USER}"
        else
            log_error "Database connection failed!"
            log_info "Make sure services are running with 'pnpm docker:up'"
            exit 1
        fi
        ;;

    status)
        log_info "Service status:"
        echo ""
        cd "$PROJECT_ROOT"
        $DOCKER_COMPOSE ps
        ;;

    *)
        echo ""
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}Nextly - Docker Development Helper${NC}"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "Usage: $0 {command} [options]"
        echo ""
        echo -e "${YELLOW}Commands:${NC}"
        echo "  up         Start all services"
        echo "  down       Stop all services"
        echo "  restart    Restart all services"
        echo "  reset      Stop services and delete ALL data (requires confirmation)"
        echo "  logs       View service logs (optional: specify service name)"
        echo "  backup     Create database backup"
        echo "  restore    Restore database from backup file"
        echo "  shell      Open PostgreSQL interactive shell"
        echo "  test       Test database connection"
        echo "  status     Show service status"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo "  $0 up                    # Start services"
        echo "  $0 test                  # Test database connection"
        echo "  $0 logs postgres         # View PostgreSQL logs"
        echo "  $0 backup                # Create backup"
        echo "  $0 restore backups/backup-20250108-143022.sql"
        echo ""
        echo -e "${YELLOW}NPM Scripts (recommended):${NC}"
        echo "  pnpm docker:up           # Start services"
        echo "  pnpm docker:down         # Stop services"
        echo "  pnpm docker:test         # Test connection"
        echo "  pnpm docker:logs         # View logs"
        echo "  pnpm docker:shell        # Open PostgreSQL shell"
        echo "  pnpm docker:backup       # Backup database"
        echo "  pnpm docker:status       # Check status"
        echo ""
        exit 1
        ;;
esac

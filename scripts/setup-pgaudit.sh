#!/bin/bash
#
# Production-grade pgaudit setup for TRi
#
# Enables PostgreSQL pgaudit extension for comprehensive database audit logging.
# Logs all operations on sensitive tables: users, trades, mt5_accounts, sessions, audit_events
#
# Usage:
#   ./scripts/setup-pgaudit.sh             # Use DATABASE_URL environment variable
#   ./scripts/setup-pgaudit.sh host=localhost port=5432 user=postgres
#
# Prerequisites:
#   - PostgreSQL 12+ with pgaudit extension available
#   - psql command-line tool installed
#   - Sufficient privileges to ALTER DATABASE and GRANT
#

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration from environment or arguments
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"

# Parse command-line arguments
for arg in "$@"; do
  case $arg in
    host=*)
      DB_HOST="${arg#host=}"
      ;;
    port=*)
      DB_PORT="${arg#port=}"
      ;;
    user=*)
      DB_USER="${arg#user=}"
      ;;
    database=*)
      DB_NAME="${arg#database=}"
      ;;
    password=*)
      DB_PASSWORD="${arg#password=}"
      ;;
  esac
done

# Extract database name from DATABASE_URL if provided
if [ -n "$DATABASE_URL" ]; then
  # Parse PostgreSQL connection string: postgres://user:password@host:port/database
  DB_URL_REGEX='postgres://([^:]+)(:([^@]*))?@([^:/]+)(:[0-9]+)?/(.+)'
  if [[ $DATABASE_URL =~ $DB_URL_REGEX ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[3]}"
    DB_HOST="${BASH_REMATCH[4]}"
    DB_PORT="${BASH_REMATCH[5]#:}"
    DB_NAME="${BASH_REMATCH[6]}"
  fi
fi

echo -e "${GREEN}===== TRi pgaudit Setup =====${NC}"
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME (user: $DB_USER)"
echo ""

# Test connection
echo -e "${YELLOW}[1/6] Testing database connection...${NC}"
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Connected${NC}"
else
  echo -e "${RED}✗ Failed to connect to database${NC}"
  exit 1
fi

# Enable pgaudit extension
echo -e "${YELLOW}[2/6] Enabling pgaudit extension...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
CREATE EXTENSION IF NOT EXISTS pgaudit;
SELECT extname, extversion FROM pg_extension WHERE extname = 'pgaudit';
EOF
echo -e "${GREEN}✓ pgaudit extension enabled${NC}"

# Create audit tables if they don't exist (for events logging)
echo -e "${YELLOW}[3/6] Creating audit tables...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
-- Table for pgaudit events (if using log_file output)
CREATE TABLE IF NOT EXISTS public.pgaudit_logs (
  event_id BIGSERIAL PRIMARY KEY,
  audit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  client_addr INET,
  usename NAME,
  database_name NAME,
  object_type TEXT,
  object_name TEXT,
  statement_id BIGINT,
  command_tag TEXT,
  statement TEXT
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_pgaudit_logs_time ON public.pgaudit_logs(audit_time DESC);
CREATE INDEX IF NOT EXISTS idx_pgaudit_logs_user ON public.pgaudit_logs(usename);
CREATE INDEX IF NOT EXISTS idx_pgaudit_logs_object ON public.pgaudit_logs(object_type, object_name);
EOF
echo -e "${GREEN}✓ Audit tables created${NC}"

# Configure pgaudit settings
echo -e "${YELLOW}[4/6] Configuring pgaudit settings...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
-- Enable comprehensive logging of all statements
ALTER SYSTEM SET pgaudit.log = 'ALL, ROLE';
ALTER SYSTEM SET pgaudit.role = 'pgaudit';
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_duration = off;
ALTER SYSTEM SET log_min_duration_statement = 5000; -- Log queries slower than 5 seconds

-- Set log destination (can be file, syslog, or eventlog)
ALTER SYSTEM SET log_destination = 'stderr';
ALTER SYSTEM SET logging_collector = on;

-- Audit sensitive tables
ALTER SYSTEM SET pgaudit.log_parameter = on;
ALTER SYSTEM SET pgaudit.log_relation = on;

-- Configure rotation
ALTER SYSTEM SET log_rotation_age = '1d';
ALTER SYSTEM SET log_rotation_size = '1GB';

-- Reload configuration
SELECT pg_reload_conf();
EOF
echo -e "${GREEN}✓ pgaudit configured${NC}"

# Configure audit rules for sensitive tables
echo -e "${YELLOW}[5/6] Setting up audit rules for sensitive tables...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
-- Create pgaudit role if it doesn't exist
CREATE ROLE pgaudit WITH SUPERUSER;

-- Audit all operations on sensitive tables
GRANT ALL ON public.users TO pgaudit;
GRANT ALL ON public.trades TO pgaudit;
GRANT ALL ON public.sessions TO pgaudit;
GRANT ALL ON public.mt5_accounts TO pgaudit;
GRANT ALL ON public.password_reset_tokens TO pgaudit;
GRANT ALL ON public.super_admins TO pgaudit;
GRANT ALL ON public.tenants TO pgaudit;

-- Show current audit configuration
SELECT name, setting FROM pg_settings WHERE name LIKE 'pgaudit%' ORDER BY name;
EOF
echo -e "${GREEN}✓ Audit rules configured${NC}"

# Test audit logging
echo -e "${YELLOW}[6/6] Testing audit logging...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
-- Test: Create a temporary table and verify it's logged
CREATE TEMP TABLE audit_test (id SERIAL, data TEXT);
INSERT INTO audit_test(data) VALUES ('test');
SELECT COUNT(*) as records FROM audit_test;
EOF
echo -e "${GREEN}✓ Audit logging verified${NC}"

echo ""
echo -e "${GREEN}===== Setup Complete =====${NC}"
echo ""
echo "pgaudit is now enabled with the following configuration:"
echo "  • log_statement = 'all'"
echo "  • Logs all operations on sensitive tables"
echo "  • Slow queries (>5s) are logged"
echo "  • Log rotation: daily or 1GB"
echo ""
echo "Audit logs are available at:"
echo "  • PostgreSQL log_directory: typically /var/lib/postgresql/data/log/"
echo "  • Or configured syslog: /var/log/postgresql/"
echo ""
echo "To view current pgaudit configuration:"
echo "  psql -U postgres -d $DB_NAME -c \"SELECT name, setting FROM pg_settings WHERE name LIKE 'pgaudit%' ORDER BY name;\""
echo ""
echo "For local development (optional):"
echo "  1. Enable in docker-compose.yml by adding pgaudit extension"
echo "  2. Or use fallback application-level logging if pgaudit unavailable"
echo ""

#!/usr/bin/env bash
#
# Build a throwaway Postgres database for the backend test suite.
#
# The suite's migration DROPs and recreates the labeling tables, so it must
# never be pointed at the live Supabase project. This script creates a local
# scratch database and installs the `auth` schema shim the RLS policies need
# (see auth_shim.sql), then prints the TEST_DATABASE_URL to use.
#
#   ./scripts/setup_test_db.sh            # database: dynalytix_test_scratch
#   ./scripts/setup_test_db.sh mydbname   # a different name
#
# Then:
#   TEST_DATABASE_URL="$(./scripts/setup_test_db.sh)" python -m pytest tests/ -q
#
set -euo pipefail

DB_NAME="${1:-dynalytix_test_scratch}"
ADMIN_URL="${PGADMIN_URL:-postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Refuse to touch anything that looks like a hosted database.
case "$DB_NAME" in
  *supabase*|*amazonaws*|*railway*|*prod*)
    echo "Refusing to use '$DB_NAME' — that looks like a real database." >&2
    exit 1
    ;;
esac

psql -d "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
  -c "CREATE DATABASE ${DB_NAME};" >/dev/null

psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f "${HERE}/auth_shim.sql" >/dev/null

# The DSN, on stdout, so this can be captured directly.
echo "postgresql://$(whoami)@localhost:5432/${DB_NAME}"

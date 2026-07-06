#!/bin/bash
# Repair or restore corrupted SQLite DB on VPS
# Usage: bash /var/www/ecommerce/scripts/repair-db.sh

set -e
DB_DIR="/var/www/ecommerce/server.js"
DB="$DB_DIR/ecom.db"

cd "$DB_DIR"

echo "==> Checking $DB"
if [ ! -f "$DB" ]; then
  echo "ERROR: $DB not found"
  exit 1
fi

check_ok() {
  local path="${1:-$DB}"
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    const row = db.prepare('PRAGMA integrity_check').get();
    const v = row.integrity_check || Object.values(row)[0];
    process.exit(v === 'ok' ? 0 : 1);
  " "$path" 2>/dev/null
}

if check_ok; then
  echo "OK: database integrity check passed"
  exit 0
fi

echo "WARN: integrity check failed — attempting restore from backup"
STAMP=$(date +%Y%m%d%H%M)
BROKEN="$DB_DIR/ecom.db.broken-$STAMP"
cp "$DB" "$BROKEN"
rm -f "$DB-wal" "$DB-shm" 2>/dev/null || true

echo "==> Searching all backup locations..."
mapfile -t CANDIDATES < <(
  {
    ls -t "$DB_DIR"/ecom.db.pre-deploy-* 2>/dev/null || true
    ls -t "$DB_DIR"/ecom.db.pre-ezyshell-* 2>/dev/null || true
    ls -t "$DB_DIR"/ecom.db.bak* 2>/dev/null || true
    ls -t /var/backups/loveriette/ecom.db* 2>/dev/null || true
    ls -t /var/backups/loveriette/*.db 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
)

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  echo "    (no backup files found yet)"
else
  echo "    found ${#CANDIDATES[@]} candidate(s)"
fi

for BACKUP in "${CANDIDATES[@]}"; do
  [ -f "$BACKUP" ] || continue
  echo "==> Trying $BACKUP"
  cp "$BACKUP" "$DB"
  rm -f "$DB-wal" "$DB-shm" 2>/dev/null || true
  if check_ok; then
    echo "OK: restored from $BACKUP"
    exit 0
  fi
  echo "    (backup also invalid, trying next)"
done

echo "==> Trying sqlite3 .recover on broken copy"
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq sqlite3 2>/dev/null || true
fi
if command -v sqlite3 >/dev/null 2>&1; then
  rm -f "$DB.recovered" 2>/dev/null || true
  if sqlite3 "$BROKEN" ".recover" 2>/dev/null | sqlite3 "$DB.recovered"; then
    if [ -f "$DB.recovered" ] && check_ok "$DB.recovered"; then
      mv "$DB.recovered" "$DB"
      rm -f "$DB-wal" "$DB-shm" 2>/dev/null || true
      echo "OK: sqlite .recover succeeded"
      exit 0
    fi
  fi
fi

echo ""
echo "ERROR: Could not repair DB automatically."
echo "Files in $DB_DIR:"
ls -la "$DB_DIR"/ecom.db* 2>/dev/null || true
echo ""
echo "Files in /var/backups/loveriette/:"
ls -la /var/backups/loveriette/ 2>/dev/null || true
echo ""
echo "If you have a good ecom.db on your PC, upload it:"
echo "  pscp ecom.db root@VPS:/var/www/ecommerce/server.js/ecom.db"
exit 1

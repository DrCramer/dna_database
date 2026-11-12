#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
workspace_database="${WORKSPACE_DATABASE_NAME:-dna_analysis}"
if [[ ! "$workspace_database" =~ ^[A-Za-z0-9_]+$ ]]; then echo 'Invalid database name.' >&2; exit 1; fi
case "${1:-}" in
    --staging)
        if [[ ! "$workspace_database" =~ ^dna_workspace_test_ ]]; then echo 'Staging requires a dna_workspace_test_* database.' >&2; exit 1; fi
        ;;
    --confirm-production-cutover) ;;
    *) echo 'Read docs/LEGACY_EXPORT_AND_REIMPORT.md first. Explicit --staging or --confirm-production-cutover is required.' >&2; exit 1 ;;
esac
if [[ ! -f .env || ! -f config/encryption.key ]]; then echo 'Restore the existing configuration and encryption key first.' >&2; exit 1; fi
# Build and mandatory checks finish before touching the database or stopping the application.
if [[ "${1:-}" == --staging ]]; then
    docker build -t dna_database-web:workspace-candidate .
else
    docker compose build web
fi
timestamp="$(date -u +%Y%m%d_%H%M%S)"
backup_dir="runtime/backups/workspace_${timestamp}"
mkdir -m 700 -p "$backup_dir"
docker compose exec -T db pg_dump -U dna_user -d "$workspace_database" --no-owner --no-acl > "$backup_dir/database.sql"
test -s "$backup_dir/database.sql"
cp .env "$backup_dir/env.before"
cp config/encryption.key "$backup_dir/encryption.key.before"
git rev-parse HEAD > "$backup_dir/commit.txt"
docker compose images -q web > "$backup_dir/previous-image-id.txt"
# Excludes the live PostgreSQL data directory. pg_dump above is the database backup.
archive_paths=(.env config/encryption.key)
for directory in runtime/uploads runtime/exports; do
    if [[ -d "$directory" ]]; then archive_paths+=("$directory"); fi
done
tar -czf "$backup_dir/files.tar.gz" "${archive_paths[@]}"
if [[ "${1:-}" == --confirm-production-cutover ]]; then
    docker compose stop web
    # Final dump after application writes have stopped.
    docker compose exec -T db pg_dump -U dna_user -d "$workspace_database" --no-owner --no-acl > "$backup_dir/database.final.sql"
    test -s "$backup_dir/database.final.sql"
fi
docker compose exec -T db psql -X -U dna_user -d "$workspace_database" -v ON_ERROR_STOP=1 < database/migrations/037_personal_workspace.sql
docker compose exec -T db psql -X -U dna_user -d "$workspace_database" -v ON_ERROR_STOP=1 < database/migrations/038_master_array_approval.sql
docker compose exec -T db psql -X -U dna_user -d "$workspace_database" -v ON_ERROR_STOP=1 < database/migrations/039_optional_staff_registration.sql
docker compose exec -T db psql -X -U dna_user -d "$workspace_database" -v ON_ERROR_STOP=1 -c 'UPDATE workspace_configuration SET enabled=true WHERE id=true;'
if [[ "${1:-}" == --staging ]]; then
    echo "Staging schema enabled in $workspace_database. Start the isolated web service with UNIFIED_WORKSPACE_ENABLED=true. Production web was not restarted."
    exit 0
fi
python3 - <<'PY'
from pathlib import Path
p = Path('.env')
lines = [line for line in p.read_text().splitlines() if not line.startswith('UNIFIED_WORKSPACE_ENABLED=')]
p.write_text('\n'.join(lines + ['UNIFIED_WORKSPACE_ENABLED=true']) + '\n')
PY
docker compose up -d --no-deps --wait --wait-timeout 180 web
echo "Cutover complete. Keep $backup_dir and the old database/archive. Do not delete volumes."

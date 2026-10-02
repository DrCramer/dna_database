#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env || ! -f config/encryption.key ]]; then
    echo 'Missing .env or encryption key. Restore the original files before updating.' >&2
    exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo 'Tracked project files have local changes. Save or commit them before updating.' >&2
    git status --short
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo 'Docker Compose v2 is required.' >&2
    exit 1
fi

mkdir -p runtime/backups
backup_file="runtime/backups/dna_analysis_$(date -u +%Y%m%d_%H%M%S).sql"
echo "Creating backup: $backup_file"
if ! docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"; then
    rm -f "$backup_file"
    echo 'Backup failed; update cancelled.' >&2
    exit 1
fi
if [[ ! -s "$backup_file" ]]; then
    rm -f "$backup_file"
    echo 'Backup is empty; update cancelled.' >&2
    exit 1
fi

old_revision="$(git rev-parse HEAD)"
git pull --ff-only origin main
schema_changes="$(git diff --name-only "$old_revision" HEAD -- database/schema.sql database/migrations/)"
if [[ -n "$schema_changes" ]]; then
    echo 'Database schema files changed. Review the release migration instructions before starting new code:' >&2
    echo "$schema_changes" >&2
    echo "Backup is saved at $backup_file" >&2
    exit 1
fi

docker compose config --quiet
docker compose up -d --build
for _attempt in {1..30}; do
    web_container="$(docker compose ps -q web)"
    health="$(docker inspect "$web_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)"
    if [[ "$health" == healthy ]]; then
        echo "Update complete: $(git log -1 --oneline)"
        echo "Backup: $backup_file"
        docker compose ps
        exit 0
    fi
    sleep 2
done
echo "Update did not pass the health check. Backup: $backup_file" >&2
docker compose logs --tail=60 web >&2
exit 1

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
    known_reference_release=false
    if [[ "$schema_changes" == *database/migrations/031_allele_references.sql* ]]; then
        known_reference_release=true
        while IFS= read -r changed_file; do
            case "$changed_file" in
                database/schema.sql|database/migrations/031_allele_references.sql) ;;
                *) known_reference_release=false ;;
            esac
        done <<< "$schema_changes"
    fi
    if [[ "$known_reference_release" == true ]]; then
        echo 'Applying additive allele reference migration 031.'
        docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/031_allele_references.sql
    else
        echo 'Database schema files changed. Review the release migration instructions before starting new code:' >&2
        echo "$schema_changes" >&2
        echo "Backup is saved at $backup_file" >&2
        exit 1
    fi
fi

# После отдельного git pull (или остановки прежнего скрипта на изменении схемы)
# diff может быть пустым. Наличие таблиц проверяем перед запуском нового кода.
reference_tables_ready="$(docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 -c "SELECT to_regclass('allele_reference_sets') IS NOT NULL AND to_regclass('allele_reference_values') IS NOT NULL AND to_regclass('genotype_panel_references') IS NOT NULL")"
if [[ "$reference_tables_ready" != t ]]; then
    echo 'Installing missing allele reference tables (migration 031).'
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/031_allele_references.sql
fi

docker compose config --quiet
docker compose build web
./scripts/prepare-runtime.sh
docker compose up -d
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

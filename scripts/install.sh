#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

for command_name in docker openssl; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
done
if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required" >&2
    exit 1
fi

database_files_exist() {
    [[ -f runtime/postgres/PG_VERSION ]] || {
        [[ -d runtime ]] &&
        { [[ ! -r runtime ]] || [[ ! -x runtime ]]; }
    } || {
        [[ -d runtime/postgres ]] &&
        { [[ ! -r runtime/postgres ]] || [[ ! -x runtime/postgres ]]; }
    }
}

if [[ ! -f .env ]]; then
    if database_files_exist; then
        echo "Database files exist but .env is missing. Restore the original .env before starting." >&2
        exit 1
    fi
    db_password="$(openssl rand -hex 32)"
    jwt_secret="$(openssl rand -hex 48)"
    admin_password="$(openssl rand -hex 24)"
    bind_ip="${WEB_BIND_IP:-127.0.0.1}"
    web_port="${WEB_PORT:-3001}"
    postgres_port="${POSTGRES_PORT:-5433}"
    frontend_url="${FRONTEND_URL:-http://localhost:${web_port}}"
    cat > .env <<ENVFILE
WEB_BIND_IP=${bind_ip}
WEB_PORT=${web_port}
POSTGRES_PORT=${postgres_port}
POSTGRES_PASSWORD=${db_password}
DATABASE_URL=postgresql://dna_user:${db_password}@db:5432/dna_analysis
JWT_SECRET=${jwt_secret}
ADMIN_PASSWORD=${admin_password}
FRONTEND_URL=${frontend_url}
CORS_ORIGIN=${frontend_url}
ENVFILE
    chmod 600 .env
    echo 'Created .env with random credentials.'
fi

mkdir -p config runtime/postgres runtime/redis runtime/uploads runtime/exports runtime/backups logs
if [[ ! -f config/encryption.key ]]; then
    if database_files_exist; then
        echo "Database files exist but config/encryption.key is missing. Restore the original key." >&2
        exit 1
    fi
    head -c 32 /dev/urandom > config/encryption.key
    chmod 600 config/encryption.key
    echo 'Created config/encryption.key.'
fi
if [[ "$(wc -c < config/encryption.key)" -ne 32 ]]; then
    echo 'config/encryption.key must be exactly 32 bytes.' >&2
    exit 1
fi

chmod 600 .env config/encryption.key
docker compose config --quiet
docker compose build web
./scripts/prepare-runtime.sh
docker compose up -d db redis

ready=false
for _attempt in {1..60}; do
    if docker compose exec -T db pg_isready -U dna_user -d dna_analysis >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 2
done
if [[ "$ready" != true ]]; then
    echo 'PostgreSQL did not become ready. Check docker compose logs db.' >&2
    exit 1
fi

db_sql() {
    docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 "$@"
}
table_count="$(db_sql -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ "$table_count" == 0 ]]; then
    echo 'Initializing empty database schema and STR loci.'
    cat database/schema.sql database/seed_loci.sql | \
        docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 --single-transaction -q
elif [[ "$(db_sql -c "SELECT to_regclass('public.users') IS NOT NULL")" != t ]]; then
    echo 'Database contains an incomplete schema. Restore a backup or investigate before installing.' >&2
    exit 1
fi

# Исправление неполного bootstrap в прежних пустых установках. Исторические
# миграции импорта здесь не запускаются; существующие массивы переиспользуются.
if [[ "$(db_sql -c "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_create_department_master_array' AND tgrelid = 'departments'::regclass AND NOT tgisinternal) AND NOT EXISTS (SELECT 1 FROM departments WHERE is_active AND master_array_id IS NULL)")" != t ]]; then
    backup_file="runtime/backups/before_install_030_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    echo "Database backup saved: $backup_file"
    echo 'Restoring department master arrays (migration 030).'
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/030_restore_department_master_arrays.sql
fi

# Ранее установленная схема получает только новые таблицы справочников (031).
if [[ "$(db_sql -c "SELECT to_regclass('allele_reference_sets') IS NOT NULL AND to_regclass('allele_reference_values') IS NOT NULL AND to_regclass('genotype_panel_references') IS NOT NULL")" != t ]]; then
    backup_file="runtime/backups/before_install_031_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    echo "Database backup saved: $backup_file"
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/031_allele_references.sql
fi

if [[ "$(db_sql -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='display_name') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='email' AND is_nullable='YES')")" != t ]]; then
    backup_file="runtime/backups/before_install_033_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    echo "Database backup saved: $backup_file"
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/033_user_display_names.sql
fi

# Probability snapshots are isolated from source DNA profiles.
if [[ "$(db_sql -c "SELECT to_regclass('public.probability_calculations') IS NOT NULL")" != t ]]; then
    backup_file="runtime/backups/before_install_034_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    echo "Database backup saved: $backup_file"
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/034_probability_calculations.sql
fi


# Revocable refresh-token storage (035), safe to repeat after interrupted updates.
session_refresh_ready="$(docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 -c "SELECT COUNT(*)=3 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions' AND column_name='expires_at' AND data_type='timestamp with time zone') FROM information_schema.columns WHERE table_schema='public' AND table_name='user_sessions' AND column_name IN ('refresh_token_hash','refresh_expires_at','session_family_id')")"
if [[ "$session_refresh_ready" != t ]]; then
    backup_file="runtime/backups/before_install_035_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/035_session_refresh_tokens.sql
fi


profile_identity_ready="$(docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 -c "SELECT indexdef LIKE '%department_id%' FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dna_profiles_year_internal_user'")"
if [[ "$profile_identity_ready" != t ]]; then
    backup_file="runtime/backups/before_install_036_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
    docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/036_profile_identity_scope.sql
fi

# Backup before enabling the new schema on an existing workspace installation.
if [[ "$(db_sql -c "SELECT to_regclass('personal_workspaces') IS NOT NULL AND to_regclass('workspace_master_approvals') IS NULL")" == t ]]; then
    backup_file="runtime/backups/before_install_038_$(date -u +%Y%m%d_%H%M%S).sql"
    docker compose exec -T db pg_dump -U dna_user -d dna_analysis > "$backup_file"
    test -s "$backup_file"
fi

# 038 never enables workspace mode and never assigns approval rights automatically.
workspace_approval_ready="$(docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 -c "SELECT to_regclass('workspace_master_approvals') IS NOT NULL")"
if [[ "$workspace_approval_ready" != t ]]; then
    if [[ "$(docker compose exec -T db psql -U dna_user -d dna_analysis -Atq -v ON_ERROR_STOP=1 -c "SELECT to_regclass('personal_workspaces') IS NOT NULL")" == t ]]; then
        docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q < database/migrations/038_master_array_approval.sql
    else
        docker compose exec -T db psql -U dna_user -d dna_analysis -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE users ADD COLUMN IF NOT EXISTS can_approve_master boolean NOT NULL DEFAULT false'
    fi
fi

user_count="$(db_sql -c 'SELECT COUNT(*) FROM users')"
if [[ "$user_count" == 0 ]]; then
    docker compose run --rm --no-deps web node scripts/bootstrap-admin.js
fi

docker compose up -d web
for _attempt in {1..60}; do
    web_container="$(docker compose ps -q web)"
    health="$(docker inspect "$web_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)"
    if [[ "$health" == healthy ]] && docker compose exec -T web node -e '
        fetch("http://127.0.0.1:3000/health").then(async response => {
            const health = await response.json();
            if (!response.ok || health.status !== "healthy") process.exit(1);
        }).catch(() => process.exit(1));
    ' >/dev/null 2>&1; then
        echo 'Installation complete. Containers:'
        docker compose ps
        echo 'Administrator: admin; password is ADMIN_PASSWORD in .env.'
        exit 0
    fi
    sleep 2
done
echo 'Web container is not healthy. Check docker compose logs web.' >&2
docker compose logs --tail=60 web >&2
exit 1

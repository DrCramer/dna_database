#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

# Сохраняем владельца файлов на хосте, даём группе node доступ к bind mounts.
# Это работает и при установке от root, без запуска web от root.
docker compose run --rm --no-deps --user 0 \
    --volume "$project_dir/config:/setup-config" web sh -ec '
    app_group=$(id -g node)
    for directory in /app/logs /app/uploads /app/exports /app/backups; do
        chgrp -R "$app_group" "$directory"
        chmod -R g+rwX "$directory"
    done
    chgrp "$app_group" /setup-config/encryption.key
    chmod 640 /setup-config/encryption.key
    '

docker compose run --rm --no-deps web node -e '
    const fs = require("fs");
    const key = fs.readFileSync("/app/config/encryption.key");
    if (key.length !== 32) throw new Error("Encryption key must be exactly 32 bytes");
    for (const directory of ["logs", "uploads", "exports", "backups"]) {
        fs.accessSync(`/app/${directory}`, fs.constants.R_OK | fs.constants.W_OK);
    }
    console.log("Runtime directories and persistent encryption key are accessible to web.");
    '

#!/usr/bin/env bash
set -euo pipefail
memory_file="${1:-/proc/meminfo}"
# A build must not push a busy host into swap thrashing. No services are stopped.
available_mib="$(awk '/^MemAvailable:/ {printf "%.0f", $2/1024}' "$memory_file")"
if [[ ! "$available_mib" =~ ^[0-9]+$ ]]; then
    printf 'Не удалось проверить свободную память перед сборкой.\n' >&2
    exit 1
fi
if (( available_mib < 1536 )); then
    printf 'Недостаточно памяти для сборки: доступно %s МиБ, требуется 1536 МиБ. Рабочий контейнер не остановлен.\n' "$available_mib" >&2
    exit 1
fi
printf 'Память перед сборкой: доступно %s МиБ.\n' "$available_mib"

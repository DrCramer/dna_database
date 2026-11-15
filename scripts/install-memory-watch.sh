#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v python3 >/dev/null
systemctl --user is-active default.target >/dev/null
python3 - "$project_dir" <<'PY'
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
units = Path.home() / '.config/systemd/user'
units.mkdir(parents=True, exist_ok=True)
script = json.dumps(str(root / 'scripts/memory-watch.py').replace('%', '%%'))
(units / 'dna-memory-watch.service').write_text('''[Unit]
Description=DNA Database host memory monitoring

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 %s
MemoryMax=64M
CPUQuota=10%%
NoNewPrivileges=yes
''' % script)
(units / 'dna-memory-watch.timer').write_text('''[Unit]
Description=Record host memory every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
''')
PY
systemctl --user daemon-reload
systemctl --user enable --now dna-memory-watch.timer
systemctl --user start dna-memory-watch.service
printf 'Мониторинг установлен: systemctl --user status dna-memory-watch.timer\n'
if [[ "$(loginctl show-user "$USER" -p Linger --value)" != yes ]]; then
    printf 'Для работы после выхода пользователя включите lingering: loginctl enable-linger %s\n' "$USER"
fi

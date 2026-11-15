#!/usr/bin/env python3
"""Local host memory snapshots. No credentials, command arguments or profile data."""
import argparse
import json
import os
from pathlib import Path
import time


def snapshot(proc=Path('/proc')):
    values = {}
    for line in (proc / 'meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        values[key] = int(value.split()[0]) // 1024
    total, available = values.get('MemTotal', 0), values.get('MemAvailable', 0)
    swap_total, swap_free = values.get('SwapTotal', 0), values.get('SwapFree', 0)
    swap_used = swap_total - swap_free
    level = 'critical' if available < max(256, total * .04) else 'warning' if available < max(768, total * .1) else 'healthy'
    top = []
    for pid in proc.iterdir():
        if not pid.name.isdigit():
            continue
        try:
            status = (pid / 'status').read_text()
            fields = dict(line.split(':', 1) for line in status.splitlines() if ':' in line)
            rss = int(fields.get('VmRSS', '0 kB').split()[0]) // 1024
            swapped = int(fields.get('VmSwap', '0 kB').split()[0]) // 1024
            if rss or swapped:
                top.append({'pid': int(pid.name), 'name': fields['Name'].strip(), 'rssMiB': rss, 'swapMiB': swapped})
        except (OSError, ValueError, KeyError):
            continue
    if swap_total and swap_used / swap_total > .85 and available < total * .2 and level == 'healthy':
        level = 'warning'
    return {'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'status': level,
            'totalMiB': total, 'availableMiB': available, 'swapTotalMiB': swap_total,
            'swapUsedMiB': swap_used, 'uptimeSeconds': int(float((proc / 'uptime').read_text().split()[0])),
            'topProcesses': sorted(top, key=lambda p: p['rssMiB'] + p['swapMiB'], reverse=True)[:10]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-build', action='store_true', help='Require 1536 MiB available before build/test')
    parser.add_argument('--once', action='store_true', help='Print summary without writing monitoring files')
    args = parser.parse_args()
    data = snapshot()
    if args.check_build:
        if data['availableMiB'] < 1536:
            print('Недостаточно памяти для сборки: доступно %s МиБ, требуется 1536 МиБ. Действующий контейнер не остановлен.' % data['availableMiB'])
            return 1
        print('Память перед сборкой: доступно %s МиБ.' % data['availableMiB'])
        return 0
    if not args.once:
        folder = Path(__file__).resolve().parent.parent / 'runtime' / 'monitoring'
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(folder, 0o700)
        target = folder / 'memory.json'
        temporary = folder / 'memory.json.tmp'
        temporary.write_text(json.dumps(data, ensure_ascii=False) + '\n')
        os.chmod(temporary, 0o600)
        temporary.replace(target)
        history = folder / 'memory.jsonl'
        if history.exists() and history.stat().st_size > 5 * 1024 * 1024:
            history.replace(folder / 'memory.previous.jsonl')
        with history.open('a') as out:
            out.write(json.dumps(data, ensure_ascii=False) + '\n')
        os.chmod(history, 0o600)
    print(json.dumps({k: v for k, v in data.items() if k != 'topProcesses'}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

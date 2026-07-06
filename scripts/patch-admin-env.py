#!/usr/bin/env python3
"""Update ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env safely."""
import json
import re
import sys
from pathlib import Path

ENV_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else '/var/www/ecommerce/.env')
PATCH_PATH = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/admin-patch.json')

patch = json.loads(PATCH_PATH.read_text(encoding='utf-8-sig'))
email = str(patch.get('email', '')).strip().lower()
password = str(patch.get('password', '')).strip()
name = str(patch.get('name', 'Site Admin')).strip() or 'Site Admin'

if not email or not password:
    raise SystemExit('email and password required')

text = ENV_PATH.read_text(encoding='utf-8') if ENV_PATH.exists() else ''
lines = text.splitlines()
keys = {
    'ADMIN_EMAIL': email,
    'ADMIN_PASSWORD': password,
    'ADMIN_NAME': name,
}
seen = set()
out = []
for raw in lines:
    if not raw.strip() or raw.strip().startswith('#'):
        out.append(raw)
        continue
    key = raw.split('=', 1)[0].strip()
    if key in keys:
        if key not in seen:
            out.append(f'{key}={keys[key]}')
            seen.add(key)
        continue
    out.append(raw)

while out and not out[-1].strip():
    out.pop()

for key, val in keys.items():
    if key not in seen:
        if out and out[-1].strip():
            out.append('')
        out.append(f'# Admin login (npm run reset-admin)')
        out.append(f'{key}={val}')
        seen.add(key)
        break

for key, val in keys.items():
    if key not in seen:
        out.append(f'{key}={val}')

ENV_PATH.write_text('\n'.join(out) + '\n', encoding='utf-8')
print(json.dumps({'ok': True, 'email': email, 'name': name}))

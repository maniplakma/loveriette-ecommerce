#!/usr/bin/env python3
"""Safely set Gmail OAuth keys in .env (no sed escaping issues)."""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ENV_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else '/var/www/ecommerce/.env')
PATCH_PATH = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/gmail-oauth-patch.json')

patch = json.loads(PATCH_PATH.read_text(encoding='utf-8-sig'))
client_id = str(patch['clientId']).strip()
client_secret = str(patch['clientSecret']).strip()

if not client_id or not client_secret:
    raise SystemExit('clientId and clientSecret required')

text = ENV_PATH.read_text(encoding='utf-8') if ENV_PATH.exists() else ''
lines = []
seen = set()
for raw in text.splitlines():
    if not raw.strip() or raw.strip().startswith('#'):
        lines.append(raw)
        continue
    key = raw.split('=', 1)[0].strip()
    if key in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'):
        if key not in seen:
            seen.add(key)
        continue
    lines.append(raw)

while lines and not lines[-1].strip():
    lines.pop()

if lines and lines[-1].strip():
    lines.append('')
if 'GOOGLE_CLIENT_ID' not in seen:
    lines.append('# Gmail OAuth')
lines.append(f'GOOGLE_CLIENT_ID={client_id}')
lines.append(f'GOOGLE_CLIENT_SECRET={client_secret}')
lines.append('')

ENV_PATH.write_text('\n'.join(lines), encoding='utf-8')

# Verify with Google: valid secret -> invalid_grant, bad secret -> invalid_client
body = urllib.parse.urlencode({
    'client_id': client_id,
    'client_secret': client_secret,
    'grant_type': 'refresh_token',
    'refresh_token': 'cursor-verify-invalid-refresh-token'
}).encode()
req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body, method='POST')
try:
    urllib.request.urlopen(req)
    result = 'unexpected_ok'
except urllib.error.HTTPError as e:
    payload = json.loads(e.read().decode('utf-8', errors='replace') or '{}')
    result = payload.get('error', f'http_{e.code}')

print(json.dumps({
    'ok': result == 'invalid_grant',
    'googleCheck': result,
    'clientIdLen': len(client_id),
    'clientSecretLen': len(client_secret),
    'envPath': str(ENV_PATH)
}))

# invalid_grant = client id + secret accepted by Google
# invalid_client = wrong id/secret pair — reset secret in Google Console
if result != 'invalid_grant':
    print(f'WARNING: Google check failed ({result}). .env was updated but credentials may be invalid.', file=sys.stderr)
    raise SystemExit(2)

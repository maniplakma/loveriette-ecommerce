#!/usr/bin/env bash
# Deploy to Contabo VPS from any machine (cloud agent, CI, local).
# Requires: sshpass, openssh-client
#
#   VPS_PASSWORD='your-root-password' bash scripts/vps-deploy-remote.sh
#
# Optional:
#   VPS_HOST=161.97.78.192 VPS_USER=root APP=/var/www/ecommerce

set -euo pipefail

VPS_HOST="${VPS_HOST:-161.97.78.192}"
VPS_USER="${VPS_USER:-root}"
APP="${APP:-/var/www/ecommerce}"
BRANCH="${BRANCH:-main}"

if [[ -z "${VPS_PASSWORD:-}" ]]; then
  echo "ERROR: Set VPS_PASSWORD (root password for ${VPS_USER}@${VPS_HOST})" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "ERROR: sshpass not installed" >&2
  exit 1
fi

REMOTE="curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/${BRANCH}/scripts/vps-deploy-production.sh | APP=${APP} BRANCH=${BRANCH} bash"

echo "==> Deploying ${BRANCH} to ${VPS_USER}@${VPS_HOST}:${APP}"
export SSHPASS="$VPS_PASSWORD"
sshpass -e ssh \
  -o StrictHostKeyChecking=accept-new \
  -o PreferredAuthentications=password \
  -o PubkeyAuthentication=no \
  "${VPS_USER}@${VPS_HOST}" \
  "$REMOTE"

echo "==> Remote deploy finished"

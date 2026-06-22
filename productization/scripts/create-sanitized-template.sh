#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/infra-agent-web"
OUT="${1:-${ROOT}/productization/dist/infra-agent-web-template}"

if [[ ! -d "${SRC}" ]]; then
  echo "Source not found: ${SRC}" >&2
  exit 1
fi

if [[ -e "${OUT}" ]]; then
  echo "Output already exists: ${OUT}" >&2
  echo "Move or remove it manually before generating a new package." >&2
  exit 1
fi

mkdir -p "${OUT}"

EXCLUDES=(
  "--exclude=.env.local"
  "--exclude=.next"
  "--exclude=node_modules"
  "--exclude=data/*"
  "--exclude=dev-server.log"
  "--exclude=*.log"
  "--exclude=coverage"
  "--exclude=tmp"
)

if command -v rsync >/dev/null 2>&1; then
  rsync -a "${EXCLUDES[@]}" "${SRC}/" "${OUT}/"
else
  (
    cd "${SRC}"
    tar \
      --exclude='.env.local' \
      --exclude='.next' \
      --exclude='node_modules' \
      --exclude='data/*' \
      --exclude='dev-server.log' \
      --exclude='*.log' \
      --exclude='coverage' \
      --exclude='tmp' \
      -cf - .
  ) | (
    cd "${OUT}"
    tar -xf -
  )
fi

mkdir -p "${OUT}/productization"
cp -R "${ROOT}/productization/commercial-template/." "${OUT}/productization/"
mkdir -p "${OUT}/productization/portable-demo"
cp -R "${ROOT}/productization/portable-demo/." "${OUT}/productization/portable-demo/"
cp "${ROOT}/productization/commercial-template/Dockerfile.demo" "${OUT}/Dockerfile.demo"
cp "${ROOT}/productization/commercial-template/docker-compose.demo.yml" "${OUT}/docker-compose.demo.yml"

mkdir -p "${OUT}/data" "${OUT}/config"
cat > "${OUT}/data/.gitignore" <<'EOF'
*
!.gitignore
EOF

cat > "${OUT}/config/powerbi-models.json" <<'EOF'
[
  {
    "key": "demo_model",
    "displayName": "Demo - Modelo comercial",
    "area": "Demo",
    "workspaceId": "00000000-0000-0000-0000-000000000000",
    "datasetId": "00000000-0000-0000-0000-000000000000",
    "enabled": false,
    "description": "Modelo demo placeholder. Sustituir por workspace/dataset del cliente."
  }
]
EOF

cat > "${OUT}/README-COMMERCIAL-TEMPLATE.md" <<'EOF'
# Infra Agent commercial template

This package is a sanitized copy intended for demo or customer bootstrap work.

Before using it:

1. Create `.env.local` from `productization/config/.env.template`.
2. Keep demo mode enabled until customer permissions and safety checks are reviewed.
3. Do not add production secrets to Git.
4. Do not reuse production SQLite databases or logs.
EOF

SECRET_MATCHES="$(
  grep -RInE \
    'sk-[A-Za-z0-9_-]{12,}|GRAPH_CLIENT_SECRET="?[^" ]{6,}|POWERBI_CLIENT_SECRET="?[^" ]{6,}|ZABBIX_TOKEN="?[^" ]{6,}|Authorization: Bearer [A-Za-z0-9._-]{12,}|client_secret[=:]"?[^" ]{6,}' \
    "${OUT}" \
    --exclude-dir=.git \
    --exclude='package-lock.json' \
    2>/dev/null \
    | grep -v '\\[redacted\\]' \
    | grep -v 'replace(/' \
    || true
)"

if [[ -n "${SECRET_MATCHES}" ]]; then
  echo "Potential secret patterns found in generated package:" >&2
  echo "${SECRET_MATCHES}" >&2
  exit 2
fi

echo "Sanitized template created at: ${OUT}"

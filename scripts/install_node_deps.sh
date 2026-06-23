#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start_common.sh
source "${SCRIPT_DIR}/start_common.sh"

echo "正在检查后端依赖..."
"${NPM_BIN}" --prefix "${BACKEND_DIR}" install --no-audit --no-fund

echo "正在检查前端依赖..."
"${NPM_BIN}" --prefix "${FRONTEND_DIR}" install --no-audit --no-fund

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${APP_DIR}/config.json"
export CONFIG_FILE

"${APP_DIR}/scripts/validate_start_config.sh"
"${APP_DIR}/scripts/install_node_deps.sh"
"${APP_DIR}/scripts/restart_web_services.sh"

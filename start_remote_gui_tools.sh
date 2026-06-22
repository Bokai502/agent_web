#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${APP_DIR}/config.json}"
export CONFIG_FILE

source "${APP_DIR}/scripts/remote_gui_runtime.sh"
remote_gui_main "$@"

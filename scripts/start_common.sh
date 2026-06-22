#!/usr/bin/env bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${APP_DIR}/config.json}"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
REMOTE_GUI_SCRIPT="${APP_DIR}/start_remote_gui_tools.sh"

read_config() {
  node -e '
const fs = require("fs")
const file = process.argv[1]
const key = process.argv[2]
const fallback = process.argv[3] ?? ""
const config = JSON.parse(fs.readFileSync(file, "utf8"))
const value = key.split(".").reduce((current, part) => current?.[part], config)
if (value === undefined || value === null || value === "") {
  process.stdout.write(fallback)
} else if (typeof value === "object") {
  process.stdout.write(JSON.stringify(value))
} else {
  process.stdout.write(String(value))
}
' "${CONFIG_FILE}" "$1" "${2:-}"
}

require_config() {
  local value
  value="$(read_config "$1")"
  if [[ -z "${value}" ]]; then
    echo "config.json 缺少 $1" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

port_available() {
  local port="$1"
  ! ss -ltn "( sport = :${port} )" | grep -q ":${port}"
}

close_port() {
  local port="$1"
  local pids

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return
  fi

  echo "closing port ${port}: ${pids}" >&2
  kill ${pids} 2>/dev/null || true

  for _ in $(seq 1 20); do
    if port_available "${port}"; then
      return
    fi
    sleep 0.2
  done

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "force closing port ${port}: ${pids}" >&2
    kill -9 ${pids} 2>/dev/null || true
  fi
}

stop_session() {
  local session="$1"
  if tmux has-session -t "${session}" 2>/dev/null; then
    tmux kill-session -t "${session}"
  fi
}

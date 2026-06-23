#!/usr/bin/env bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${APP_DIR}/config.json}"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
REMOTE_GUI_SCRIPT="${APP_DIR}/start_remote_gui_tools.sh"

node_major_version() {
  "$1" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true
}

find_node_bin() {
  local candidate major
  local candidates=()

  if [[ -n "${OPEN_CODEX_NODE:-}" ]]; then
    candidates+=("${OPEN_CODEX_NODE}")
  fi

  candidates+=(
    "${HOME}/.local/opt/node/bin/node"
    "${HOME}/.local/bin/node"
  )

  while IFS= read -r candidate; do
    candidates+=("${candidate}")
  done < <(type -P -a node 2>/dev/null || true)

  for candidate in "${candidates[@]}"; do
    if [[ ! -x "${candidate}" ]]; then
      continue
    fi
    major="$(node_major_version "${candidate}")"
    if [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
      printf '%s' "${candidate}"
      return 0
    fi
  done

  echo "未找到 Node.js 20 或更高版本。请安装新版本，或设置 OPEN_CODEX_NODE=/path/to/node 后重试。" >&2
  return 1
}

NODE_BIN="${NODE_BIN:-$(find_node_bin)}"
NODE_DIR="$(cd "$(dirname "${NODE_BIN}")" && pwd)"
NPM_BIN="${NPM_BIN:-${NODE_DIR}/npm}"
if [[ ! -x "${NPM_BIN}" ]]; then
  NPM_BIN="$(command -v npm || true)"
fi
if [[ -z "${NPM_BIN}" || ! -x "${NPM_BIN}" ]]; then
  echo "未找到 npm。请确认 Node.js 安装包含 npm。" >&2
  exit 1
fi

export PATH="${NODE_DIR}:${PATH}"
export NODE_BIN
export NPM_BIN

read_config() {
  "${NODE_BIN}" -e '
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

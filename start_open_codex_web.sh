#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${APP_DIR}/config.json"
BACKEND_DIR="${APP_DIR}/backend"
FRONTEND_DIR="${APP_DIR}/frontend"
BACKEND_SESSION="${BACKEND_SESSION:-ocw-backend}"
FRONTEND_SESSION="${FRONTEND_SESSION:-ocw-frontend}"

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

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "配置文件不存在：${CONFIG_FILE}" >&2
  exit 1
fi

BACKEND_PORT="$(read_config server.port 3001)"
FRONTEND_HOST="$(read_config frontend.host 0.0.0.0)"
FRONTEND_PORT="$(read_config frontend.httpsPort 5175)"
FREECAD_WORKSPACE_DIR="$(read_config workspace.workspaceDir "$(read_config freecad.workspaceDir)")"
FREECAD_RPC_HOST="$(read_config workspace.rpcHost "$(read_config freecad.rpcHost localhost)")"
FREECAD_RPC_PORT="$(read_config workspace.rpcPort "$(read_config freecad.rpcPort 9876)")"

if [[ -z "${FREECAD_WORKSPACE_DIR}" ]]; then
  echo "config.json 缺少 workspace.workspaceDir" >&2
  exit 1
fi

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

  echo "closing backend port ${port}: ${pids}" >&2
  kill ${pids} 2>/dev/null || true

  for _ in $(seq 1 20); do
    if port_available "${port}"; then
      return
    fi
    sleep 0.2
  done

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "force closing backend port ${port}: ${pids}" >&2
    kill -9 ${pids} 2>/dev/null || true
  fi
}

stop_session() {
  local session="$1"
  if tmux has-session -t "${session}" 2>/dev/null; then
    tmux kill-session -t "${session}"
  fi
}

for session in $(tmux ls -F '#S' 2>/dev/null | grep -E '^ocw-backend($|-)|^ocw-frontend($|-)' || true); do
  stop_session "${session}"
done

close_port "${BACKEND_PORT}"

if ! port_available "${BACKEND_PORT}"; then
  echo "无法关闭后端端口 ${BACKEND_PORT}。" >&2
  exit 1
fi

tmux new-session -d -s "${BACKEND_SESSION}" -c "${BACKEND_DIR}" \
  "BACKEND_PORT='${BACKEND_PORT}' FREECAD_WORKSPACE_DIR='${FREECAD_WORKSPACE_DIR}' FREECAD_RPC_HOST='${FREECAD_RPC_HOST}' FREECAD_RPC_PORT='${FREECAD_RPC_PORT}' npm run dev"

tmux new-session -d -s "${FRONTEND_SESSION}" -c "${FRONTEND_DIR}" \
  "BACKEND_PORT='${BACKEND_PORT}' npm run dev:https -- --host '${FRONTEND_HOST}' --port '${FRONTEND_PORT}' --strictPort"

echo "backend:  http://localhost:${BACKEND_PORT}  tmux=${BACKEND_SESSION}"
echo "frontend: https://10.110.10.11:${FRONTEND_PORT}  tmux=${FRONTEND_SESSION}"

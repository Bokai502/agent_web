#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${APP_DIR}/config.json"
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

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "配置文件不存在：${CONFIG_FILE}" >&2
  exit 1
fi

if [[ "${SKIP_CONFIG_VALIDATE:-0}" != "1" ]]; then
  VALIDATE_ARGS=(--config "${CONFIG_FILE}" --timeout-ms "${CONFIG_VALIDATE_TIMEOUT_MS:-5000}")
  if [[ "${SKIP_CONFIG_SERVICE_CHECKS:-0}" == "1" ]]; then
    VALIDATE_ARGS+=(--skip-services)
  fi
  echo "正在校验 config.json：${CONFIG_FILE}"
  if ! node "${APP_DIR}/scripts/validate_config.mjs" "${VALIDATE_ARGS[@]}"; then
    echo ""
    echo "config.json 校验失败，已停止启动。请修复上面列出的配置或服务连接问题后重试。" >&2
    echo "如只想跳过外部服务连通性检查，可临时使用：SKIP_CONFIG_SERVICE_CHECKS=1 ./start_open_codex_web.sh" >&2
    echo "如需完全跳过配置校验，可临时使用：SKIP_CONFIG_VALIDATE=1 ./start_open_codex_web.sh" >&2
    exit 1
  fi
fi

BACKEND_PORT="$(require_config server.port)"
FRONTEND_HOST="$(read_config frontend.host 0.0.0.0)"
FRONTEND_PORT="$(require_config frontend.httpsPort)"
FRONTEND_PUBLIC_HOST="$(read_config frontend.publicHost)"
BACKEND_SESSION="${BACKEND_SESSION:-$(read_config tmux.backendSession ocw-backend)}"
FRONTEND_SESSION="${FRONTEND_SESSION:-$(read_config tmux.frontendSession ocw-frontend)}"
FREECAD_WORKSPACE_DIR="$(require_config workspace.templateDir)"
FREECAD_RPC_HOST="$(require_config workspace.rpcHost)"
FREECAD_RPC_PORT="$(require_config workspace.rpcPort)"

if [[ -z "${FREECAD_WORKSPACE_DIR}" ]]; then
  echo "config.json 缺少 workspace.templateDir" >&2
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

stop_session "${BACKEND_SESSION}"
stop_session "${FRONTEND_SESSION}"

close_port "${BACKEND_PORT}"
close_port "${FRONTEND_PORT}"

if ! port_available "${BACKEND_PORT}"; then
  echo "无法关闭后端端口 ${BACKEND_PORT}。" >&2
  exit 1
fi
if ! port_available "${FRONTEND_PORT}"; then
  echo "无法关闭前端端口 ${FRONTEND_PORT}。" >&2
  exit 1
fi

if [[ -x "${REMOTE_GUI_SCRIPT}" ]]; then
  CONFIG_FILE="${CONFIG_FILE}" "${REMOTE_GUI_SCRIPT}" start
else
  echo "远程 GUI 启动脚本不可执行：${REMOTE_GUI_SCRIPT}" >&2
  exit 1
fi

tmux new-session -d -s "${BACKEND_SESSION}" -c "${BACKEND_DIR}" \
  "BACKEND_PORT='${BACKEND_PORT}' FREECAD_WORKSPACE_DIR='${FREECAD_WORKSPACE_DIR}' FREECAD_RPC_HOST='${FREECAD_RPC_HOST}' FREECAD_RPC_PORT='${FREECAD_RPC_PORT}' npm run dev"

tmux new-session -d -s "${FRONTEND_SESSION}" -c "${FRONTEND_DIR}" \
  "BACKEND_PORT='${BACKEND_PORT}' npm run dev:https -- --host '${FRONTEND_HOST}' --port '${FRONTEND_PORT}' --strictPort"

DISPLAY_FRONTEND_HOST="${FRONTEND_PUBLIC_HOST:-${FRONTEND_HOST}}"
if [[ "${DISPLAY_FRONTEND_HOST}" == "0.0.0.0" ]]; then
  DISPLAY_FRONTEND_HOST="localhost"
fi

echo "backend:  http://localhost:${BACKEND_PORT}  tmux=${BACKEND_SESSION}"
echo "frontend: https://${DISPLAY_FRONTEND_HOST}:${FRONTEND_PORT}  tmux=${FRONTEND_SESSION}"

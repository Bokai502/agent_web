#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start_common.sh
source "${SCRIPT_DIR}/start_common.sh"

BACKEND_PORT="$(require_config server.port)"
FRONTEND_HOST="$(read_config frontend.host 0.0.0.0)"
FRONTEND_PORT="$(require_config frontend.httpsPort)"
FRONTEND_PUBLIC_HOST="$(read_config frontend.publicHost)"
BACKEND_SESSION="${BACKEND_SESSION:-$(read_config tmux.backendSession ocw-backend)}"
FRONTEND_SESSION="${FRONTEND_SESSION:-$(read_config tmux.frontendSession ocw-frontend)}"
FREECAD_WORKSPACE_DIR="$(require_config workspace.templateDir)"
FREECAD_RPC_HOST="$(require_config workspace.rpcHost)"
FREECAD_RPC_PORT="$(require_config workspace.rpcPort)"

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
  "PATH='${NODE_DIR}':\"\${PATH}\" BACKEND_PORT='${BACKEND_PORT}' FREECAD_WORKSPACE_DIR='${FREECAD_WORKSPACE_DIR}' FREECAD_RPC_HOST='${FREECAD_RPC_HOST}' FREECAD_RPC_PORT='${FREECAD_RPC_PORT}' '${NPM_BIN}' run dev"

tmux new-session -d -s "${FRONTEND_SESSION}" -c "${FRONTEND_DIR}" \
  "PATH='${NODE_DIR}':\"\${PATH}\" BACKEND_PORT='${BACKEND_PORT}' '${NPM_BIN}' run dev:https -- --host '${FRONTEND_HOST}' --port '${FRONTEND_PORT}' --strictPort"

DISPLAY_FRONTEND_HOST="${FRONTEND_PUBLIC_HOST:-${FRONTEND_HOST}}"
if [[ "${DISPLAY_FRONTEND_HOST}" == "0.0.0.0" ]]; then
  DISPLAY_FRONTEND_HOST="localhost"
fi

echo "backend:  http://localhost:${BACKEND_PORT}  tmux=${BACKEND_SESSION}"
echo "frontend: https://${DISPLAY_FRONTEND_HOST}:${FRONTEND_PORT}  tmux=${FRONTEND_SESSION}"

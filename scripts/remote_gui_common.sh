#!/usr/bin/env bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${APP_DIR}/config.json}"
LOG_DIR="${LOG_DIR:-${HOME}/.remote-cad/logs}"

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
export PATH="${NODE_DIR}:${PATH}"
export NODE_BIN

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

require_executable() {
  local file="$1"
  if [[ ! -x "${file}" ]]; then
    echo "missing executable: ${file}" >&2
    exit 1
  fi
}

load_remote_gui_config() {
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "配置文件不存在：${CONFIG_FILE}" >&2
    exit 1
  fi

  DESKTOP_LAUNCHER="${DESKTOP_LAUNCHER:-$(require_config tools.remoteDesktopLauncher)}"
  FREECAD_LAUNCHER="${FREECAD_LAUNCHER:-$(require_config tools.cad.launcher)}"
  PARAVIEW_LAUNCHER="${PARAVIEW_LAUNCHER:-$(require_config tools.paraview.launcher)}"
  COMSOL_LAUNCHER="${COMSOL_LAUNCHER:-$(require_config tools.comsol.launcher)}"
  COMSOL_SUDO="${COMSOL_SUDO:-$(read_config tools.comsol.sudo sudo)}"

  FREECAD_DISPLAY="$(require_config tools.cad.displayNum)"
  FREECAD_VNC_PORT="$(require_config tools.cad.vncPort)"
  FREECAD_NOVNC_PORT="$(require_config tools.cad.noVncPort)"
  FREECAD_RPC_HOST="$(require_config workspace.rpcHost)"
  FREECAD_RPC_PORT="$(require_config workspace.rpcPort)"
  FREECAD_RPC_BIND_HOST="${FREECAD_RPC_BIND_HOST:-0.0.0.0}"
  FREECAD_RPC_SCRIPT="${FREECAD_RPC_SCRIPT:-/data/lbk/codex_web/FreeCAD_data/bin/freecad_rpc_server.py}"
  FREECAD_CONFIG_BIN="$(read_config tools.cad.bin)"

  CURRENT_USER="$(id -un)"
  PARAVIEW_DISPLAY="$(require_config tools.paraview.displayNum)"
  PARAVIEW_VNC_PORT="$(require_config tools.paraview.vncPort)"
  PARAVIEW_NOVNC_PORT="$(require_config tools.paraview.noVncPort)"
  COMSOL_DISPLAY="$(require_config tools.comsol.displayNum)"
  COMSOL_VNC_PORT="$(require_config tools.comsol.vncPort)"
  COMSOL_NOVNC_PORT="$(require_config tools.comsol.noVncPort)"

  for launcher in "${DESKTOP_LAUNCHER}" "${FREECAD_LAUNCHER}" "${PARAVIEW_LAUNCHER}" "${COMSOL_LAUNCHER}"; do
    require_executable "${launcher}"
  done
}

remote_gui_host() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

wait_for_tcp_port() {
  local port="$1"
  local attempts="${2:-20}"

  for _ in $(seq 1 "${attempts}"); do
    if ss -ltn "( sport = :${port} )" 2>/dev/null | grep -q ":${port}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

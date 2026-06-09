#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-${APP_DIR}/config.json}"
ACTION="${1:-start}"
LOG_DIR="${HOME}/.remote-cad/logs"

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
CURRENT_USER="$(id -un)"
PARAVIEW_DISPLAY="$(require_config tools.paraview.displayNum)"
PARAVIEW_VNC_PORT="$(require_config tools.paraview.vncPort)"
PARAVIEW_NOVNC_PORT="$(require_config tools.paraview.noVncPort)"
COMSOL_DISPLAY="$(require_config tools.comsol.displayNum)"
COMSOL_VNC_PORT="$(require_config tools.comsol.vncPort)"
COMSOL_NOVNC_PORT="$(require_config tools.comsol.noVncPort)"
FREECAD_CONFIG_BIN="$(read_config tools.cad.bin)"

require_executable() {
  local file="$1"
  if [[ ! -x "${file}" ]]; then
    echo "missing executable: ${file}" >&2
    exit 1
  fi
}

for launcher in "${DESKTOP_LAUNCHER}" "${FREECAD_LAUNCHER}" "${PARAVIEW_LAUNCHER}" "${COMSOL_LAUNCHER}"; do
  require_executable "${launcher}"
done

ensure_desktop() {
  local name="$1"
  local display_num="$2"
  local vnc_port="$3"
  local novnc_port="$4"
  local log_suffix="$5"

  mkdir -p "${LOG_DIR}"

  if ! pgrep -u "$(id -un)" -af "Xvfb ${display_num}( |$)" >/dev/null 2>&1; then
    rm -f "/tmp/.X${display_num#:}-lock" "/tmp/.X11-unix/X${display_num#:}"
    setsid Xvfb "${display_num}" -screen 0 1920x1080x24 >"${LOG_DIR}/xvfb-${log_suffix}.log" 2>&1 < /dev/null &
  fi

  local display_ready=0
  for _ in {1..30}; do
    if DISPLAY="${display_num}" xdpyinfo >/dev/null 2>&1; then
      display_ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "${display_ready}" != "1" ]]; then
    pkill -u "$(id -un)" -f "Xvfb ${display_num}( |$)" >/dev/null 2>&1 || true
    rm -f "/tmp/.X${display_num#:}-lock" "/tmp/.X11-unix/X${display_num#:}"
    setsid Xvfb "${display_num}" -screen 0 1920x1080x24 >"${LOG_DIR}/xvfb-${log_suffix}.log" 2>&1 < /dev/null &
    for _ in {1..30}; do
      if DISPLAY="${display_num}" xdpyinfo >/dev/null 2>&1; then
        display_ready=1
        break
      fi
      sleep 0.5
    done
    if [[ "${display_ready}" != "1" ]]; then
      echo "${name} display ${display_num} 未就绪，查看 ${LOG_DIR}/xvfb-${log_suffix}.log" >&2
      return 1
    fi
  fi

  if ! pgrep -u "$(id -un)" -af "DISPLAY=${display_num} .*openbox|env DISPLAY=${display_num} openbox" >/dev/null 2>&1; then
    setsid env DISPLAY="${display_num}" openbox >"${LOG_DIR}/openbox-${log_suffix}.log" 2>&1 < /dev/null &
    sleep 1
  fi

  if ! pgrep -u "$(id -un)" -af "x11vnc .* -display ${display_num} .* -rfbport ${vnc_port}" >/dev/null 2>&1; then
    setsid x11vnc -display "${display_num}" -localhost -forever -shared -nopw -rfbport "${vnc_port}" >"${LOG_DIR}/x11vnc-${log_suffix}.log" 2>&1 < /dev/null &
  fi

  local vnc_ready=0
  for _ in {1..20}; do
    if ss -ltn "( sport = :${vnc_port} )" 2>/dev/null | grep -q ":${vnc_port}"; then
      vnc_ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "${vnc_ready}" != "1" ]]; then
    echo "${name} VNC 端口 ${vnc_port} 未就绪，查看 ${LOG_DIR}/x11vnc-${log_suffix}.log" >&2
    return 1
  fi

  if ! pgrep -u "$(id -un)" -af "websockify --web .* ${novnc_port} localhost:${vnc_port}|launch.sh --vnc localhost:${vnc_port} --listen ${novnc_port}" >/dev/null 2>&1; then
    setsid /usr/share/novnc/utils/launch.sh --vnc localhost:"${vnc_port}" --listen "${novnc_port}" >"${LOG_DIR}/novnc-${log_suffix}.log" 2>&1 < /dev/null &
  fi

  local novnc_ready=0
  for _ in {1..20}; do
    if ss -ltn "( sport = :${novnc_port} )" 2>/dev/null | grep -q ":${novnc_port}"; then
      novnc_ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "${novnc_ready}" != "1" ]]; then
    echo "${name} noVNC 端口 ${novnc_port} 未就绪，查看 ${LOG_DIR}/novnc-${log_suffix}.log" >&2
    return 1
  fi

  echo "${name} 远程桌面已启动。"
  echo "浏览器访问：http://$(hostname -I 2>/dev/null | awk '{print $1}'):${novnc_port}/vnc.html?autoconnect=true&resize=scale&path=websockify"
  echo "日志目录：${LOG_DIR}"
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

wait_for_freecad_rpc() {
  local attempts="${1:-20}"

  for _ in $(seq 1 "${attempts}"); do
    freecad_rpc_reject_foreign_listener
    if freecad_rpc_available; then
      return 0
    fi
    sleep 1
  done
  return 1
}

freecad_rpc_available() {
  local pid

  while read -r pid; do
    [[ -n "${pid}" ]] || continue
    if [[ "$(stat -c %U "/proc/${pid}" 2>/dev/null || true)" == "${CURRENT_USER}" ]]; then
      return 0
    fi
  done < <(freecad_rpc_listener_pids)

  return 1
}

freecad_rpc_port_listening() {
  ss -ltn "( sport = :${FREECAD_RPC_PORT} )" 2>/dev/null | grep -q ":${FREECAD_RPC_PORT}"
}

freecad_rpc_listener_pids() {
  ss -H -ltnp "( sport = :${FREECAD_RPC_PORT} )" 2>/dev/null \
    | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
    | sort -u
}

freecad_rpc_listener_owners() {
  local pid
  local owner
  local seen=""

  while read -r pid; do
    [[ -n "${pid}" ]] || continue
    owner="$(stat -c %U "/proc/${pid}" 2>/dev/null || true)"
    [[ -n "${owner}" ]] || continue
    if [[ " ${seen} " != *" ${owner} "* ]]; then
      printf '%s\n' "${owner}"
      seen="${seen} ${owner}"
    fi
  done < <(freecad_rpc_listener_pids)
}

freecad_rpc_reject_foreign_listener() {
  local owners

  if ! freecad_rpc_port_listening || freecad_rpc_available; then
    return 0
  fi

  owners="$(freecad_rpc_listener_owners | paste -sd, -)"
  if [[ -z "${owners}" ]]; then
    owners="unknown"
  fi
  echo "FreeCAD RPC 端口 ${FREECAD_RPC_PORT} 已被其他用户占用（owner=${owners}，当前用户=${CURRENT_USER}）。" >&2
  echo "请先停止该用户的 FreeCAD RPC，或为当前用户配置独立的 workspace.rpcPort；不能复用别人的 RPC 会话。" >&2
  return 1
}

freecad_rpc_bound_to_requested_host() {
  local listeners

  listeners="$(ss -ltn "( sport = :${FREECAD_RPC_PORT} )" 2>/dev/null || true)"
  if [[ "${FREECAD_RPC_BIND_HOST}" == "0.0.0.0" ]]; then
    grep -Eq "(^|[[:space:]])(0\\.0\\.0\\.0|\\*):${FREECAD_RPC_PORT}([[:space:]]|$)" <<<"${listeners}"
  else
    grep -q "${FREECAD_RPC_BIND_HOST}:${FREECAD_RPC_PORT}" <<<"${listeners}"
  fi
}

start_freecad_rpc() {
  local freecad_bin=""
  local candidate
  local settings_file

  for candidate in "${FREECAD_BIN:-}" /data/lbk/codex_web/FreeCAD_data/bin/freecad-1.1.1 "${FREECAD_CONFIG_BIN}" FreeCAD freecad; do
    [[ -n "${candidate}" ]] || continue
    if [[ -x "${candidate}" ]]; then
      freecad_bin="${candidate}"
      break
    fi
    if command -v "${candidate}" >/dev/null 2>&1; then
      freecad_bin="$(command -v "${candidate}")"
      break
    fi
  done

  if [[ -z "${freecad_bin}" ]]; then
    echo "未找到 FreeCAD 可执行文件（尝试了 config、FreeCAD/freecad）。" >&2
    return 1
  fi
  if [[ ! -f "${FREECAD_RPC_SCRIPT}" ]]; then
    echo "FreeCAD RPC 脚本不存在：${FREECAD_RPC_SCRIPT}" >&2
    return 1
  fi
  freecad_rpc_reject_foreign_listener

  for settings_file in \
    /data/lbk/codex_web/FreeCAD_data/home_1_1_1/.local/share/FreeCAD/freecad_mcp_settings.json \
    /data/lbk/codex_web/FreeCAD_data/home_1_1_1/.local/share/FreeCAD/v1-1/freecad_mcp_settings.json \
    "/data/lbk/codex_web/FreeCAD_data/home_1_1_1_${CURRENT_USER}/.local/share/FreeCAD/freecad_mcp_settings.json" \
    "/data/lbk/codex_web/FreeCAD_data/home_1_1_1_${CURRENT_USER}/.local/share/FreeCAD/v1-1/freecad_mcp_settings.json"; do
    if [[ -f "${settings_file}" ]]; then
      node -e '
const fs = require("fs")
const file = process.argv[1]
const settings = JSON.parse(fs.readFileSync(file, "utf8"))
settings.auto_start_rpc = false
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
' "${settings_file}"
    fi
  done

  if pgrep -u "$(id -un)" -af "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1 && ! freecad_rpc_available; then
    echo "FreeCAD 已在运行但 RPC 端口 ${FREECAD_RPC_PORT} 未监听，重启 FreeCAD。" >&2
    pkill -u "$(id -un)" -f "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1 || true
    sleep 1
  fi
  if pgrep -u "$(id -un)" -af "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1 && freecad_rpc_available && ! freecad_rpc_bound_to_requested_host; then
    echo "FreeCAD RPC 未绑定到 ${FREECAD_RPC_BIND_HOST}:${FREECAD_RPC_PORT}，重启 FreeCAD。" >&2
    pkill -u "$(id -un)" -f "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1 || true
    sleep 1
  fi

  if ! pgrep -u "$(id -un)" -af "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1; then
    setsid env \
      DISPLAY="${FREECAD_DISPLAY}" \
      LIBGL_ALWAYS_SOFTWARE=1 \
      MESA_GL_VERSION_OVERRIDE=3.3 \
      FREECAD_RPC_HOST="${FREECAD_RPC_BIND_HOST}" \
      FREECAD_RPC_PORT="${FREECAD_RPC_PORT}" \
      FREECAD_RPC_BLOCK=1 \
      "${freecad_bin}" "${FREECAD_RPC_SCRIPT}" >"${LOG_DIR}/freecad-rpc-${FREECAD_RPC_PORT}.log" 2>&1 < /dev/null &
    echo "FreeCAD RPC 已请求启动，DISPLAY=${FREECAD_DISPLAY} port=${FREECAD_RPC_PORT}"
  fi

  if wait_for_freecad_rpc 30; then
    echo "FreeCAD RPC 已启动：http://${FREECAD_RPC_BIND_HOST}:${FREECAD_RPC_PORT}"
  else
    echo "FreeCAD RPC 端口 ${FREECAD_RPC_PORT} 未就绪，查看 ${LOG_DIR}/freecad-rpc-${FREECAD_RPC_PORT}.log" >&2
    return 1
  fi
}

stop_desktop() {
  local display_num="$1"
  local vnc_port="$2"
  local novnc_port="$3"
  local app_pattern="$4"

  pkill -u "$(id -un)" -f "${app_pattern}" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "websockify --web .* ${novnc_port} localhost:${vnc_port}|launch.sh --vnc localhost:${vnc_port} --listen ${novnc_port}" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "x11vnc .* -display ${display_num} .* -rfbport ${vnc_port}" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "Xvfb ${display_num}( |$)" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "DISPLAY=${display_num} .*openbox|env DISPLAY=${display_num} openbox" >/dev/null 2>&1 || true
}

case "${ACTION}" in
  start)
    ;;
  stop|restart|status)
    if [[ "${ACTION}" == "status" ]]; then
      pgrep -af "Xvfb (${FREECAD_DISPLAY}|${PARAVIEW_DISPLAY}|${COMSOL_DISPLAY})( |$)|x11vnc .* -display (${FREECAD_DISPLAY}|${PARAVIEW_DISPLAY}|${COMSOL_DISPLAY})|websockify .* (${FREECAD_NOVNC_PORT} localhost:${FREECAD_VNC_PORT}|${PARAVIEW_NOVNC_PORT} localhost:${PARAVIEW_VNC_PORT}|${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT})|launch.sh --vnc localhost:(${FREECAD_VNC_PORT}|${PARAVIEW_VNC_PORT}|${COMSOL_VNC_PORT})|(^|/)(freecad|paraview|comsol|comsollauncher)( |$)" || true
    else
      stop_desktop "${FREECAD_DISPLAY}" "${FREECAD_VNC_PORT}" "${FREECAD_NOVNC_PORT}" "(^|/)(freecad|FreeCAD)( |$)"
      stop_desktop "${PARAVIEW_DISPLAY}" "${PARAVIEW_VNC_PORT}" "${PARAVIEW_NOVNC_PORT}" "(^|/)paraview( |$)"
    fi
    if [[ "${ACTION}" == "status" ]]; then
      pgrep -af "Xvfb ${COMSOL_DISPLAY}|x11vnc .*${COMSOL_VNC_PORT}|websockify .*${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT}|launch.sh --vnc localhost:${COMSOL_VNC_PORT}|(^|/)(comsol|comsollauncher)( |$)" || true
    else
      pkill -u "$(id -un)" -f "websockify --web .* ${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT}|launch.sh --vnc localhost:${COMSOL_VNC_PORT} --listen ${COMSOL_NOVNC_PORT}" >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "x11vnc .* -display ${COMSOL_DISPLAY} .* -rfbport ${COMSOL_VNC_PORT}" >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "Xvfb ${COMSOL_DISPLAY} " >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1 || true
      tmux kill-session -t "comsol-remote-${COMSOL_NOVNC_PORT}" >/dev/null 2>&1 || true
    fi
    [[ "${ACTION}" == "restart" ]] || exit 0
    ;;
  *)
    echo "usage: $0 [start|stop|restart|status]" >&2
    exit 1
    ;;
esac

ensure_desktop "freecad" "${FREECAD_DISPLAY}" "${FREECAD_VNC_PORT}" "${FREECAD_NOVNC_PORT}" "freecad"
ensure_desktop "paraview" "${PARAVIEW_DISPLAY}" "${PARAVIEW_VNC_PORT}" "${PARAVIEW_NOVNC_PORT}" "paraview"

export DISPLAY="${FREECAD_DISPLAY}"
export LIBGL_ALWAYS_SOFTWARE=1
export MESA_GL_VERSION_OVERRIDE=3.3
start_freecad_rpc

export DISPLAY="${PARAVIEW_DISPLAY}"
if ! pgrep -u "$(id -un)" -af "(^|/)paraview( |$)" >/dev/null 2>&1; then
  if command -v paraview >/dev/null 2>&1; then
    setsid "$(command -v paraview)" >"${LOG_DIR}/paraview.log" 2>&1 < /dev/null &
    echo "ParaView 已启动，DISPLAY=${DISPLAY}"
  else
    echo "未找到 paraview 可执行文件。" >&2
  fi
fi
if ! pgrep -u "$(id -un)" -af "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1; then
  "${COMSOL_SUDO}" "${COMSOL_LAUNCHER}"
fi

echo "Remote GUI tools requested."
echo "FreeCAD:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):${FREECAD_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "ParaView: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PARAVIEW_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "COMSOL:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):${COMSOL_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"

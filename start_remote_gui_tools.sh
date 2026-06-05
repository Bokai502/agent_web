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
if ! pgrep -u "$(id -un)" -af "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1; then
  FREECAD_ENV_BIN="${FREECAD_BIN:-}"
  FREECAD_BIN=""
  for candidate in "${FREECAD_ENV_BIN}" "${FREECAD_CONFIG_BIN}" FreeCAD freecad; do
    [[ -n "${candidate}" ]] || continue
    if [[ -x "${candidate}" ]]; then
      FREECAD_BIN="${candidate}"
      break
    fi
    if command -v "${candidate}" >/dev/null 2>&1; then
      FREECAD_BIN="$(command -v "${candidate}")"
      break
    fi
  done
  if [[ -n "${FREECAD_BIN}" ]]; then
    setsid "${FREECAD_BIN}" >"${LOG_DIR}/freecad.log" 2>&1 < /dev/null &
    echo "FreeCAD 已启动，DISPLAY=${DISPLAY}"
  else
    echo "未找到 FreeCAD 可执行文件（尝试了 FreeCAD/freecad）。" >&2
  fi
fi

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

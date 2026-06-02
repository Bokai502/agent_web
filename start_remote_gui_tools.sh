#!/usr/bin/env bash
set -euo pipefail

DESKTOP_LAUNCHER="${DESKTOP_LAUNCHER:-/usr/local/bin/start-remote-cad-desktop}"
FREECAD_LAUNCHER="${FREECAD_LAUNCHER:-/usr/local/bin/start-freecad-remote}"
PARAVIEW_LAUNCHER="${PARAVIEW_LAUNCHER:-/usr/local/bin/start-paraview-remote}"
COMSOL_LAUNCHER="${COMSOL_LAUNCHER:-/usr/local/bin/start-comsol-remote}"
ACTION="${1:-start}"
LOG_DIR="${HOME}/.remote-cad/logs"

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
      pgrep -af "Xvfb :(1|2|32)( |$)|x11vnc .* -display :(1|2|32)|websockify .* (6080 localhost:5901|6081 localhost:5902|6082 localhost:5932)|launch.sh --vnc localhost:(5901|5902|5932)|(^|/)(freecad|paraview|comsol|comsollauncher)( |$)" || true
    else
      stop_desktop ":1" "5901" "6080" "(^|/)(freecad|FreeCAD)( |$)"
      stop_desktop ":2" "5902" "6081" "(^|/)paraview( |$)"
    fi
    if [[ "${ACTION}" == "status" ]]; then
      pgrep -af "Xvfb :32|x11vnc .*5932|websockify .*6082 localhost:5932|launch.sh --vnc localhost:5932|(^|/)(comsol|comsollauncher)( |$)" || true
    else
      pkill -u "$(id -un)" -f "websockify --web .* 6082 localhost:5932|launch.sh --vnc localhost:5932 --listen 6082" >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "x11vnc .* -display :32 .* -rfbport 5932" >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "Xvfb :32 " >/dev/null 2>&1 || true
      pkill -u "$(id -un)" -f "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1 || true
      tmux kill-session -t comsol-remote-6082 >/dev/null 2>&1 || true
    fi
    [[ "${ACTION}" == "restart" ]] || exit 0
    ;;
  *)
    echo "usage: $0 [start|stop|restart|status]" >&2
    exit 1
    ;;
esac

ensure_desktop "freecad" ":1" "5901" "6080" "freecad"
ensure_desktop "paraview" ":2" "5902" "6081" "paraview"

export DISPLAY=":1"
export LIBGL_ALWAYS_SOFTWARE=1
export MESA_GL_VERSION_OVERRIDE=3.3
if ! pgrep -u "$(id -un)" -af "(^|/)(freecad|FreeCAD)( |$)" >/dev/null 2>&1; then
  FREECAD_BIN=""
  for candidate in /data/lbk/codex_web/FreeCAD_data/bin/freecad-1.1.1 FreeCAD freecad; do
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

export DISPLAY=":2"
if ! pgrep -u "$(id -un)" -af "(^|/)paraview( |$)" >/dev/null 2>&1; then
  if command -v paraview >/dev/null 2>&1; then
    setsid "$(command -v paraview)" >"${LOG_DIR}/paraview.log" 2>&1 < /dev/null &
    echo "ParaView 已启动，DISPLAY=${DISPLAY}"
  else
    echo "未找到 paraview 可执行文件。" >&2
  fi
fi
if ! pgrep -u "$(id -un)" -af "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1; then
  "${COMSOL_LAUNCHER}"
fi

echo "Remote GUI tools requested."
echo "FreeCAD:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):6080/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "ParaView: http://$(hostname -I 2>/dev/null | awk '{print $1}'):6081/vnc.html?autoconnect=true&resize=scale&path=websockify"
echo "COMSOL:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):6082/vnc.html?autoconnect=true&resize=scale&path=websockify"

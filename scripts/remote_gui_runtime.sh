#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/remote_gui_common.sh
source "${SCRIPT_DIR}/remote_gui_common.sh"
# shellcheck source=scripts/remote_gui_desktop.sh
source "${SCRIPT_DIR}/remote_gui_desktop.sh"
# shellcheck source=scripts/remote_gui_freecad_rpc.sh
source "${SCRIPT_DIR}/remote_gui_freecad_rpc.sh"

remote_gui_status() {
  pgrep -af "Xvfb (${FREECAD_DISPLAY}|${PARAVIEW_DISPLAY}|${COMSOL_DISPLAY})( |$)|x11vnc .* -display (${FREECAD_DISPLAY}|${PARAVIEW_DISPLAY}|${COMSOL_DISPLAY})|websockify .* (${FREECAD_NOVNC_PORT} localhost:${FREECAD_VNC_PORT}|${PARAVIEW_NOVNC_PORT} localhost:${PARAVIEW_VNC_PORT}|${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT})|launch.sh --vnc localhost:(${FREECAD_VNC_PORT}|${PARAVIEW_VNC_PORT}|${COMSOL_VNC_PORT})|(^|/)(freecad|paraview|comsol|comsollauncher)( |$)" || true
  pgrep -af "Xvfb ${COMSOL_DISPLAY}|x11vnc .*${COMSOL_VNC_PORT}|websockify .*${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT}|launch.sh --vnc localhost:${COMSOL_VNC_PORT}|(^|/)(comsol|comsollauncher)( |$)" || true
}

remote_gui_stop() {
  stop_desktop "${FREECAD_DISPLAY}" "${FREECAD_VNC_PORT}" "${FREECAD_NOVNC_PORT}" "(^|/)(freecad|FreeCAD)( |$)"
  stop_desktop "${PARAVIEW_DISPLAY}" "${PARAVIEW_VNC_PORT}" "${PARAVIEW_NOVNC_PORT}" "(^|/)paraview( |$)"
  pkill -u "$(id -un)" -f "websockify --web .* ${COMSOL_NOVNC_PORT} localhost:${COMSOL_VNC_PORT}|launch.sh --vnc localhost:${COMSOL_VNC_PORT} --listen ${COMSOL_NOVNC_PORT}" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "x11vnc .* -display ${COMSOL_DISPLAY} .* -rfbport ${COMSOL_VNC_PORT}" >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "Xvfb ${COMSOL_DISPLAY} " >/dev/null 2>&1 || true
  pkill -u "$(id -un)" -f "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1 || true
  tmux kill-session -t "comsol-remote-${COMSOL_NOVNC_PORT}" >/dev/null 2>&1 || true
}

remote_gui_start() {
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
  echo "FreeCAD:  http://$(remote_gui_host):${FREECAD_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"
  echo "ParaView: http://$(remote_gui_host):${PARAVIEW_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"
  echo "COMSOL:   http://$(remote_gui_host):${COMSOL_NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale&path=websockify"
}

remote_gui_main() {
  local action="${1:-start}"

  load_remote_gui_config

  case "${action}" in
    start)
      remote_gui_start
      ;;
    stop)
      remote_gui_stop
      ;;
    restart)
      remote_gui_stop
      remote_gui_start
      ;;
    status)
      remote_gui_status
      ;;
    *)
      echo "usage: $0 [start|stop|restart|status]" >&2
      return 1
      ;;
  esac
}

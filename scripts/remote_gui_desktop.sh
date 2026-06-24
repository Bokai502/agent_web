#!/usr/bin/env bash

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
    if pgrep -u "$(id -un)" -af "websockify --web .* ${novnc_port} localhost:${vnc_port}|launch.sh --vnc localhost:${vnc_port} --listen ${novnc_port}" >/dev/null 2>&1; then
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
  echo "浏览器访问：http://$(remote_gui_host):${novnc_port}/vnc.html?autoconnect=true&resize=scale&path=websockify"
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

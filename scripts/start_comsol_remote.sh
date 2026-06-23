#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/remote_gui_common.sh
source "${SCRIPT_DIR}/remote_gui_common.sh"
# shellcheck source=scripts/remote_gui_desktop.sh
source "${SCRIPT_DIR}/remote_gui_desktop.sh"

load_remote_gui_config

COMSOL_BIN="${COMSOL_BIN:-/usr/local/bin/comsol}"
if [[ ! -x "${COMSOL_BIN}" ]]; then
  if command -v comsol >/dev/null 2>&1; then
    COMSOL_BIN="$(command -v comsol)"
  else
    echo "未找到 COMSOL 可执行文件。" >&2
    exit 1
  fi
fi

ensure_desktop "COMSOL" "${COMSOL_DISPLAY}" "${COMSOL_VNC_PORT}" "${COMSOL_NOVNC_PORT}" "comsol-${COMSOL_DISPLAY#:}"

if [[ $# -gt 0 ]]; then
  setsid env DISPLAY="${COMSOL_DISPLAY}" LIBGL_ALWAYS_SOFTWARE=1 MESA_GL_VERSION_OVERRIDE=3.3 "${COMSOL_BIN}" "$@" >"${LOG_DIR}/comsol-${COMSOL_DISPLAY#:}.log" 2>&1 < /dev/null &
  echo "COMSOL 已启动加载参数，DISPLAY=${COMSOL_DISPLAY}"
elif ! pgrep -u "$(id -un)" -af "(^|/)(comsol|comsollauncher)( |$)" >/dev/null 2>&1; then
  setsid env DISPLAY="${COMSOL_DISPLAY}" LIBGL_ALWAYS_SOFTWARE=1 MESA_GL_VERSION_OVERRIDE=3.3 "${COMSOL_BIN}" >"${LOG_DIR}/comsol-${COMSOL_DISPLAY#:}.log" 2>&1 < /dev/null &
  echo "COMSOL 已启动，DISPLAY=${COMSOL_DISPLAY}"
else
  echo "COMSOL 已在运行，未重复启动。"
fi

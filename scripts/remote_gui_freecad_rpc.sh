#!/usr/bin/env bash

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

disable_freecad_rpc_autostart() {
  local settings_file

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
}

resolve_freecad_bin() {
  local candidate

  for candidate in "${FREECAD_BIN:-}" /data/lbk/codex_web/FreeCAD_data/bin/freecad-1.1.1 "${FREECAD_CONFIG_BIN}" FreeCAD freecad; do
    [[ -n "${candidate}" ]] || continue
    if [[ -x "${candidate}" ]]; then
      printf '%s' "${candidate}"
      return 0
    fi
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done

  return 1
}

start_freecad_rpc() {
  local freecad_bin

  freecad_bin="$(resolve_freecad_bin || true)"
  if [[ -z "${freecad_bin}" ]]; then
    echo "未找到 FreeCAD 可执行文件（尝试了 config、FreeCAD/freecad）。" >&2
    return 1
  fi
  if [[ ! -f "${FREECAD_RPC_SCRIPT}" ]]; then
    echo "FreeCAD RPC 脚本不存在：${FREECAD_RPC_SCRIPT}" >&2
    return 1
  fi
  freecad_rpc_reject_foreign_listener
  disable_freecad_rpc_autostart

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

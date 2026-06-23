#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/start_common.sh
source "${SCRIPT_DIR}/start_common.sh"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "配置文件不存在：${CONFIG_FILE}" >&2
  exit 1
fi

if [[ "${SKIP_CONFIG_VALIDATE:-0}" == "1" ]]; then
  exit 0
fi

VALIDATE_ARGS=(--config "${CONFIG_FILE}" --timeout-ms "${CONFIG_VALIDATE_TIMEOUT_MS:-5000}")
if [[ "${SKIP_CONFIG_SERVICE_CHECKS:-0}" == "1" ]]; then
  VALIDATE_ARGS+=(--skip-services)
fi

echo "正在校验 config.json：${CONFIG_FILE}"
if ! "${NODE_BIN}" "${APP_DIR}/scripts/validate_config.mjs" "${VALIDATE_ARGS[@]}"; then
  echo ""
  echo "config.json 校验失败，已停止启动。请修复上面列出的配置或服务连接问题后重试。" >&2
  echo "如只想跳过外部服务连通性检查，可临时使用：SKIP_CONFIG_SERVICE_CHECKS=1 ./start_open_codex_web.sh" >&2
  echo "如需完全跳过配置校验，可临时使用：SKIP_CONFIG_VALIDATE=1 ./start_open_codex_web.sh" >&2
  exit 1
fi

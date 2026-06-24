#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <workspace-dir> <percentage>" >&2
  exit 2
fi

workspace_dir="$1"
percentage="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
progress_cli="$script_dir/../../../agents/progress_cli.py"
status="running"
completed_arg=()
note="CAD箱体构建中"

if [[ "$percentage" == "100" || "$percentage" == "100.0" ]]; then
  status="completed"
  completed_arg=(--completed)
  note="CAD箱体构建完成"
fi

python3 "$progress_cli" \
  --workspace-dir "$workspace_dir" \
  --role cad_box \
  --status "$status" \
  --percentage "$percentage" \
  "${completed_arg[@]}" \
  --note "$note"

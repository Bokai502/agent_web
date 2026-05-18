#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"

PYTHON_BIN="${PYTHON_BIN:-/data/conda/bin/python}"
EXTRA_PYTHONPATH="${EXTRA_PYTHONPATH:-/tmp/codex_openpyxl_py313}"

BOM_JSON="${BOM_JSON:-/data/lbk/codex_web/FreeCAD_data/v7_data/00_inputs/real_bom.json}"
SIMULATION_BACKEND="${SIMULATION_BACKEND:-comsol_local}"
MULTISTART="${MULTISTART:-1}"
SEED="${SEED:-930001}"
SAMPLE_ID="${SAMPLE_ID:-930001}"
TARGET_FILL_RATIO="${TARGET_FILL_RATIO:-0.42}"
CLEARANCE_MM="${CLEARANCE_MM:-3.0}"
CONNECT_EXISTING_MPHSERVER="${CONNECT_EXISTING_MPHSERVER:-0}"

COMMAND="run"
if [[ $# -gt 0 && "${1}" != --* ]]; then
  COMMAND="${1}"
  shift
fi
case "${COMMAND}" in
  run-all)
    COMMAND="run"
    ;;
  load-simulation-tools)
    ;;
  raw|run|step|steps)
    ;;
  *)
    COMMAND="step ${COMMAND}"
    ;;
esac

FILTERED_ARGS=()
for arg in "$@"; do
  if [[ "${arg}" == "--connect-existing-mphserver" && "${CONNECT_EXISTING_MPHSERVER}" != "1" ]]; then
    echo "warning: ignoring --connect-existing-mphserver because CONNECT_EXISTING_MPHSERVER=1 is not set; comsol_local will auto-start/manage mphserver." >&2
    continue
  fi
  FILTERED_ARGS+=("${arg}")
done

cd "${REPO_ROOT}"

PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PYTHONPATH="${PARENT_DIR}:${EXTRA_PYTHONPATH}${PYTHONPATH:+:${PYTHONPATH}}"

exec "${PYTHON_BIN}" -m codex_agents.cli ${COMMAND} \
  --bom-json "${BOM_JSON}" \
  --simulation-backend "${SIMULATION_BACKEND}" \
  --sample-id "${SAMPLE_ID}" \
  --seed "${SEED}" \
  --clearance-mm "${CLEARANCE_MM}" \
  --multistart "${MULTISTART}" \
  --target-fill-ratio "${TARGET_FILL_RATIO}" \
  "${FILTERED_ARGS[@]}"

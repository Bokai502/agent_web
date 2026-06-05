#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONDA_PROFILE="${CONDA_PROFILE:-/data/conda/etc/profile.d/conda.sh}"
CONDA_ENV="${CONDA_ENV:-cosyvoice_vllm}"
CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"

source "${CONDA_PROFILE}"
conda activate "${CONDA_ENV}"

cd "${APP_DIR}/backend/cosyvoice3/CosyVoice"
CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES}" python cosyvoice_vllm_server.py

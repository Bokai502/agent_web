#!/usr/bin/env bash
set -euo pipefail

source /data/conda/etc/profile.d/conda.sh
conda activate cosyvoice_vllm

cd /data/lbk/codex_web/open_codex_web/backend/cosyvoice3/CosyVoice
CUDA_VISIBLE_DEVICES=0 python cosyvoice_vllm_server.py

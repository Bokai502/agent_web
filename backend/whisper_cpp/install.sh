#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHISPER_DIR="${SCRIPT_DIR}/whisper.cpp"
MODELS_DIR="${WHISPER_MODELS_DIR:-/data/llm_models/Whisper}"
MODEL_FILE="${MODELS_DIR}/ggml-large-v3-turbo.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

mkdir -p "${MODELS_DIR}"

if [ ! -d "${WHISPER_DIR}/.git" ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_DIR}"
else
  git -C "${WHISPER_DIR}" pull --ff-only
fi

cmake -S "${WHISPER_DIR}" -B "${WHISPER_DIR}/build-cuda" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_CUDA=ON \
  -DCUDAToolkit_ROOT=/usr/local/cuda-12.1 \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda-12.1/bin/nvcc \
  -DCMAKE_CUDA_ARCHITECTURES=90
cmake --build "${WHISPER_DIR}/build-cuda" --config Release -j"$(nproc)"

if [ ! -s "${MODEL_FILE}" ]; then
  curl -L \
    --fail \
    --retry 5 \
    --retry-delay 3 \
    --connect-timeout 30 \
    --continue-at - \
    "${MODEL_URL}" \
    -o "${MODEL_FILE}"
fi

echo "whisper.cpp binary: ${WHISPER_DIR}/build-cuda/bin/whisper-cli"
echo "model: ${MODEL_FILE}"

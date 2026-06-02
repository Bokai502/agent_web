# whisper.cpp local deployment

This folder is the local deployment home for whisper.cpp.

## Default model

The web transcription endpoint defaults to:

- `large-v3-turbo`: `models/ggml-large-v3-turbo.bin`

The model is downloaded from:

`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin`

## Other downloadable ggml models

Common whisper.cpp model files in `ggerganov/whisper.cpp` include:

- `ggml-tiny.bin`, `ggml-tiny.en.bin`
- `ggml-base.bin`, `ggml-base.en.bin`
- `ggml-small.bin`, `ggml-small.en.bin`
- `ggml-medium.bin`, `ggml-medium.en.bin`
- `ggml-large-v1.bin`
- `ggml-large-v2.bin`
- `ggml-large-v3.bin`
- `ggml-large-v3-turbo.bin`
- quantized variants such as `q5_0`, `q8_0` where available

## Install

From `open_codex_web/backend`:

```bash
./whisper_cpp/install.sh
```

The backend expects:

- binary: `whisper_cpp/whisper.cpp/build-cuda/bin/whisper-cli`
- model: `whisper_cpp/models/ggml-large-v3-turbo.bin`

You can override paths with environment variables:

- `WHISPER_CPP_BIN`
- `WHISPER_MODEL_PATH`
- `WHISPER_FFMPEG_BIN`
- `WHISPER_LANGUAGE`
- `WHISPER_CUDA_VISIBLE_DEVICES` defaults to `1`

The browser page uploads 16 kHz mono WAV. Non-WAV uploads require `ffmpeg` to convert audio before whisper.cpp runs.

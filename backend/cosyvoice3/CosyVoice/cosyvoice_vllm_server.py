import argparse
import asyncio
from contextlib import suppress
import io
import logging
import os
import sys
import tempfile
import time
import traceback
import wave

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

logging.getLogger("matplotlib").setLevel(logging.WARNING)

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(ROOT_DIR, "third_party/Matcha-TTS"))

from vllm import ModelRegistry

from cosyvoice.vllm.cosyvoice2 import CosyVoice2ForCausalLM

ModelRegistry.register_model("CosyVoice2ForCausalLM", CosyVoice2ForCausalLM)

from cosyvoice.cli.cosyvoice import AutoModel

MAX_TEXT_LENGTH = int(os.environ.get("COSYVOICE_MAX_TEXT_LENGTH", "5000"))
MAX_PROMPT_WAV_BYTES = int(os.environ.get("COSYVOICE_MAX_PROMPT_WAV_BYTES", str(25 * 1024 * 1024)))
DEBUG_ERRORS = os.environ.get("COSYVOICE_DEBUG_ERRORS", "").lower() in {"1", "true", "yes"}

app = FastAPI(title="CosyVoice vLLM Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cosyvoice = None
inference_lock = asyncio.Lock()


def require_model():
    if cosyvoice is None:
        raise HTTPException(status_code=503, detail="CosyVoice model is not loaded")
    return cosyvoice


def validate_text(name, value):
    value = (value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{name} is required")
    if len(value) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=413, detail=f"{name} is too long")
    return value


def generate_data(model_output):
    for item in model_output:
        speech = item["tts_speech"].detach().cpu().numpy()
        speech = np.clip(speech, -1.0, 1.0)
        audio = (speech * (2**15)).astype(np.int16).tobytes()
        yield audio


def generate_wav_response(model_output):
    model = require_model()
    pcm = b"".join(generate_data(model_output))
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(model.sample_rate)
        wav.writeframes(pcm)
    wav_buffer.seek(0)
    return Response(
        content=wav_buffer.getvalue(),
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


def error_response(route_name, exc):
    logging.exception("%s failed", route_name)
    payload = {"error": str(exc)}
    if DEBUG_ERRORS:
        payload["detail"] = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
    return JSONResponse(status_code=500, content=payload)


async def save_upload_to_temp_wav(upload: UploadFile):
    suffix = os.path.splitext(upload.filename or "")[1].lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        suffix = ".wav"

    total_bytes = 0
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="cosyvoice_prompt_", suffix=suffix, delete=False) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_PROMPT_WAV_BYTES:
                    raise HTTPException(status_code=413, detail="prompt_wav is too large")
                tmp.write(chunk)
            return tmp.name
    except Exception:
        remove_temp_file(tmp_path)
        raise


def remove_temp_file(path):
    if path:
        with suppress(FileNotFoundError):
            os.unlink(path)


async def run_inference(route_name, inference_fn):
    started_at = time.monotonic()
    async with inference_lock:
        try:
            response = await asyncio.to_thread(inference_fn)
            logging.info("%s completed in %.2fs", route_name, time.monotonic() - started_at)
            return response
        except HTTPException as exc:
            raise exc
        except Exception as exc:
            return error_response(route_name, exc)


@app.get("/health")
async def health():
    return {
        "status": "ok" if cosyvoice is not None else "loading",
        "sample_rate": cosyvoice.sample_rate if cosyvoice is not None else None,
    }


@app.get("/inference_zero_shot")
@app.post("/inference_zero_shot")
async def inference_zero_shot(
    tts_text: str = Form(),
    prompt_text: str = Form(),
    prompt_wav: UploadFile = File(),
):
    tts_text = validate_text("tts_text", tts_text)
    prompt_text = validate_text("prompt_text", prompt_text)
    prompt_path = None
    try:
        prompt_path = await save_upload_to_temp_wav(prompt_wav)
        return await run_inference(
            "inference_zero_shot",
            lambda: generate_wav_response(
                require_model().inference_zero_shot(tts_text, prompt_text, prompt_path)
            ),
        )
    finally:
        remove_temp_file(prompt_path)


@app.get("/inference_cross_lingual")
@app.post("/inference_cross_lingual")
async def inference_cross_lingual(tts_text: str = Form(), prompt_wav: UploadFile = File()):
    tts_text = validate_text("tts_text", tts_text)
    prompt_path = None
    try:
        prompt_path = await save_upload_to_temp_wav(prompt_wav)
        return await run_inference(
            "inference_cross_lingual",
            lambda: generate_wav_response(require_model().inference_cross_lingual(tts_text, prompt_path)),
        )
    finally:
        remove_temp_file(prompt_path)


@app.get("/inference_instruct2")
@app.post("/inference_instruct2")
async def inference_instruct2(
    tts_text: str = Form(),
    instruct_text: str = Form(),
    prompt_wav: UploadFile = File(),
):
    tts_text = validate_text("tts_text", tts_text)
    instruct_text = validate_text("instruct_text", instruct_text)
    prompt_path = None
    try:
        prompt_path = await save_upload_to_temp_wav(prompt_wav)
        return await run_inference(
            "inference_instruct2",
            lambda: generate_wav_response(
                require_model().inference_instruct2(tts_text, instruct_text, prompt_path)
            ),
        )
    finally:
        remove_temp_file(prompt_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=str, default=os.environ.get("COSYVOICE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=50000)
    parser.add_argument(
        "--model_dir",
        type=str,
        default=os.environ.get("COSYVOICE_MODEL_DIR", "/data/llm_models/Fun-CosyVoice3-0.5B-2512"),
    )
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--no_vllm", action="store_true")
    parser.add_argument("--log_level", default=os.environ.get("COSYVOICE_LOG_LEVEL", "info"))
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO))
    cosyvoice = AutoModel(model_dir=args.model_dir, load_vllm=not args.no_vllm, fp16=args.fp16)
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)

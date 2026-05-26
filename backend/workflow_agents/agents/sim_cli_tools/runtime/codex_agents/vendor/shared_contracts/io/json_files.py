from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Any


def read_json(path: Path | str) -> Any:
    """Read UTF-8 JSON from ``path``."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path | str, data: Any) -> Path:
    """Write UTF-8 JSON with stable formatting and return the path."""
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return output_path


def write_json_atomic(path: Path | str, data: Any) -> Path:
    """Atomically write UTF-8 JSON and return the final path."""
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=str(output_path.parent),
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, output_path)
    except Exception:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        raise
    return output_path


def ready_marker_path(path: Path | str) -> Path:
    """Return the ready marker path for a produced artifact."""
    artifact = Path(path)
    return artifact.with_name(f"{artifact.name}.ready")


def failed_marker_path(path: Path | str) -> Path:
    """Return the failed marker path for a produced artifact."""
    artifact = Path(path)
    return artifact.with_name(f"{artifact.name}.failed")


def write_ready_marker(path: Path | str) -> Path:
    """Write a ready marker for ``path`` after the artifact is complete."""
    marker = ready_marker_path(path)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("ready\n", encoding="utf-8")
    return marker


def write_failed_marker(path: Path | str, message: str = "") -> Path:
    """Write a failed marker for ``path``."""
    marker = failed_marker_path(path)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text((message or "failed") + "\n", encoding="utf-8")
    return marker


def is_ready(path: Path | str) -> bool:
    """Return true when an artifact and its ready marker both exist."""
    artifact = Path(path)
    return artifact.exists() and ready_marker_path(artifact).exists()

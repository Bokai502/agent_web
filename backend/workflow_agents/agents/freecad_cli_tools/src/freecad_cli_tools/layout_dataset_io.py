"""Atomic JSON I/O helpers for layout dataset files."""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable

from freecad_cli_tools.layout_dataset_common import LayoutDatasetError


def load_json_file(path: str | Path) -> dict[str, Any]:
    """Load a JSON object from disk."""
    file_path = Path(path)
    with file_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise LayoutDatasetError(f"{file_path} must contain a JSON object.")
    return payload


def serialize_json_payload(payload: dict[str, Any]) -> str:
    """Serialize a JSON payload with stable formatting."""
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def atomic_write_text(
    path: Path,
    text: str,
    *,
    replace_file: Callable[[str | os.PathLike[str], str | os.PathLike[str]], None] = os.replace,
) -> None:
    """Atomically replace a text file."""
    staged_path = stage_atomic_text(path, text)
    try:
        replace_file(staged_path, path)
        staged_path = None
    finally:
        cleanup_atomic_file(staged_path)


def stage_atomic_text(path: Path, text: str) -> Path:
    """Write text to a staged temp file in the destination directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        cleanup_atomic_file(temp_path)
        raise
    return temp_path


def stage_existing_file_backup(path: Path) -> Path | None:
    """Copy an existing file into a temp-file backup."""
    if not path.exists():
        return None
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.bak.", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(path.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        cleanup_atomic_file(temp_path)
        raise
    return temp_path


def restore_atomic_target(
    path: Path,
    backup_path: Path | None,
    existed: bool,
    *,
    replace_file: Callable[[str | os.PathLike[str], str | os.PathLike[str]], None] = os.replace,
) -> None:
    """Restore a file from backup or remove a newly-created target."""
    if backup_path is not None:
        replace_file(backup_path, path)
        return
    if not existed:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()


def cleanup_atomic_file(path: Path | None) -> None:
    """Delete a staged temp file if it still exists."""
    if path is None:
        return
    with contextlib.suppress(FileNotFoundError):
        path.unlink()

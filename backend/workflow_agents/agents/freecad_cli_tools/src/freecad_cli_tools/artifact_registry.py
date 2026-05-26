"""Shared artifact registry helpers for FreeCAD CLI commands."""

from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .runtime_config import get_default_artifact_registry_dir

try:
    import fcntl
except ImportError:  # pragma: no cover - only relevant on non-POSIX systems.
    fcntl = None

RUN_ID_ENV_VAR = "FREECAD_RUN_ID"
SESSION_ID_ENV_VAR = "FREECAD_SESSION_ID"
THREAD_ID_ENV_VAR = "FREECAD_THREAD_ID"
TURN_ID_ENV_VAR = "FREECAD_TURN_ID"
CALLER_ENV_VAR = "FREECAD_CALLER"
AGENT_ENV_VAR = "FREECAD_AGENT_NAME"


def add_registry_args(parser: Any) -> None:
    """Add optional artifact-registry correlation fields to a CLI parser."""
    parser.add_argument(
        "--run-id",
        default=None,
        help="Optional external run identifier for artifact registry records.",
    )
    parser.add_argument(
        "--session-id",
        default=None,
        help="Optional external session identifier used to correlate registry records.",
    )
    parser.add_argument(
        "--thread-id",
        default=None,
        help="Optional external thread identifier used to correlate registry records.",
    )
    parser.add_argument(
        "--turn-id",
        default=None,
        help="Optional external turn identifier used to correlate registry records.",
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_run_id() -> str:
    """Return a readable, unique run identifier."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"fc_run_{timestamp}_{uuid.uuid4().hex[:6]}"


def _value_from_args_or_env(args: Any, attr_name: str, env_name: str) -> str | None:
    if args is not None:
        value = getattr(args, attr_name, None)
        if value:
            return str(value)
    value = os.getenv(env_name)
    return value or None


@dataclass(frozen=True)
class RegistryContext:
    run_id: str
    session_id: str | None
    thread_id: str | None
    turn_id: str | None
    caller: str | None
    agent_name: str | None
    registry_dir: Path


@dataclass
class ArtifactRegistryRun:
    context: RegistryContext
    record: dict[str, Any]
    manifest_path: Path


def resolve_registry_context(args: Any | None = None) -> RegistryContext:
    """Resolve registry metadata from CLI args and environment."""
    return RegistryContext(
        run_id=_value_from_args_or_env(args, "run_id", RUN_ID_ENV_VAR) or generate_run_id(),
        session_id=_value_from_args_or_env(args, "session_id", SESSION_ID_ENV_VAR),
        thread_id=_value_from_args_or_env(args, "thread_id", THREAD_ID_ENV_VAR),
        turn_id=_value_from_args_or_env(args, "turn_id", TURN_ID_ENV_VAR),
        caller=os.getenv(CALLER_ENV_VAR) or "freecad_cli_tools",
        agent_name=os.getenv(AGENT_ENV_VAR),
        registry_dir=get_default_artifact_registry_dir(),
    )


def _manifest_relative_path(run_id: str) -> str:
    return f"runs/{run_id}.json"


def _atomic_json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_path)


def _with_index_lock(index_path: Path):
    if fcntl is None:  # pragma: no cover - Linux is the supported environment here.
        return contextlib.nullcontext(None)

    lock_path = index_path.with_suffix(index_path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    @contextlib.contextmanager
    def manager():
        with lock_path.open("w", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield None
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    return manager()


def _update_index(context: RegistryContext) -> None:
    index_path = context.registry_dir / "index.json"
    relative_manifest_path = _manifest_relative_path(context.run_id)
    with _with_index_lock(index_path):
        if index_path.is_file():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                index = {}
        else:
            index = {}

        index.setdefault("version", 1)
        index.setdefault("runs", {})[context.run_id] = relative_manifest_path
        if context.session_id:
            entries = index.setdefault("sessions", {}).setdefault(context.session_id, [])
            if relative_manifest_path not in entries:
                entries.append(relative_manifest_path)

        _atomic_json_write(index_path, index)


def _write_run_record(registry_run: ArtifactRegistryRun) -> None:
    _atomic_json_write(registry_run.manifest_path, registry_run.record)
    _update_index(registry_run.context)


def _emit_registry_warning(action: str, exc: BaseException) -> None:
    print(
        f"WARNING: artifact registry {action} failed: {exc}",
        file=sys.stderr,
    )


def start_registry_run(
    args: Any | None,
    *,
    tool: str,
    operation_type: str,
    inputs: dict[str, Any],
) -> ArtifactRegistryRun | None:
    """Create a started registry record. Errors are non-fatal."""
    context = resolve_registry_context(args)
    manifest_path = context.registry_dir / _manifest_relative_path(context.run_id)
    now = _utc_now_iso()
    record: dict[str, Any] = {
        "version": 1,
        "run_id": context.run_id,
        "session_id": context.session_id,
        "thread_id": context.thread_id,
        "turn_id": context.turn_id,
        "created_at": now,
        "updated_at": now,
        "source": {
            "caller": context.caller,
            "agent": context.agent_name,
        },
        "operation": {
            "tool": tool,
            "type": operation_type,
            "status": "started",
        },
        "inputs": inputs,
        "outputs": {},
        "artifacts": [],
        "result": {},
        "error": None,
    }
    registry_run = ArtifactRegistryRun(
        context=context,
        record=record,
        manifest_path=manifest_path,
    )
    try:
        _write_run_record(registry_run)
    except Exception as exc:
        _emit_registry_warning("start", exc)
        return None
    return registry_run


def artifact_entry(kind: str, path: str | Path | None) -> dict[str, Any] | None:
    """Build a registry artifact entry for a file path."""
    if path in (None, ""):
        return None
    target = Path(path)
    return {
        "kind": kind,
        "path": str(target),
        "exists": target.exists(),
    }


def finalize_registry_run(
    registry_run: ArtifactRegistryRun | None,
    *,
    status: str,
    outputs: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    artifacts: list[dict[str, Any] | None] | None = None,
) -> None:
    """Update a registry run record. Errors are non-fatal."""
    if registry_run is None:
        return
    registry_run.record["updated_at"] = _utc_now_iso()
    registry_run.record["operation"]["status"] = status
    registry_run.record["outputs"] = outputs or {}
    registry_run.record["result"] = result or {}
    registry_run.record["error"] = error
    registry_run.record["artifacts"] = [item for item in (artifacts or []) if item is not None]
    try:
        _write_run_record(registry_run)
    except Exception as exc:
        _emit_registry_warning("finalize", exc)


def build_error_payload(
    code: str,
    message: str,
    *,
    details: Any | None = None,
) -> dict[str, Any]:
    """Return a normalized error object for registry records."""
    payload = {
        "code": code,
        "message": message,
    }
    if details is not None:
        payload["details"] = details
    return payload

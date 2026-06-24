"""Shared helpers for CAD builder class APIs."""

from __future__ import annotations

import json
import os
import tempfile
import xmlrpc.client
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(encoded)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def default_spec_path(workspace_dir: str | Path) -> Path:
    return Path(workspace_dir).expanduser().resolve() / "00_inputs/cad_build_spec.json"


def default_cad_dir(workspace_dir: str | Path) -> Path:
    return Path(workspace_dir).expanduser().resolve() / "01_cad"


def default_doc_name(workspace_dir: str | Path, operation: str | None = None) -> str:
    path = Path(workspace_dir).expanduser().resolve()
    version = path.name
    workspace = path.parent.parent.name if path.parent.name == "versions" else path.name
    thermal_kind = _thermal_kind_from_workspace(workspace)
    user = "user"
    parts = list(path.parts)
    if "users" in parts:
        index = parts.index("users")
        if index + 1 < len(parts):
            user = parts[index + 1]
    raw = "_".join(part for part in (thermal_kind, user, version, operation) if part)
    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw)
    return safe.strip("_") or "cad_document"


def _thermal_kind_from_workspace(workspace: str) -> str:
    normalized = workspace.lower().replace("-", "_")
    if "thermal_catch" in normalized:
        return "thermal_catch"
    if "thermal" in normalized:
        return "thermal"
    return normalized.strip("_") or "thermal"


def load_spec(path: Path) -> dict[str, Any]:
    spec = read_json(path)
    if spec.get("schema_version") != "cad_build_spec/1.0":
        raise ValueError(f"{path} is not cad_build_spec/1.0")
    components = spec.get("components")
    if not isinstance(components, list) or not components:
        raise ValueError("cad_build_spec.components must be a non-empty list")
    return spec


def normalize_runtime_path(path: Path) -> str:
    return str(Path(path).expanduser().resolve())


def find_repo_root(start: Path) -> Path | None:
    current = start.expanduser().resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / "config.json").exists():
            return candidate
    return None


def freecad_rpc_settings(
    host: str | None,
    port: int | None,
    *,
    start_path: Path | None = None,
) -> tuple[str, int]:
    if host and port:
        return host, int(port)
    config_path = os.getenv("CODEX_WEB_CONFIG_PATH")
    if not config_path and start_path is not None:
        repo_root = find_repo_root(start_path)
        if repo_root is not None:
            config_path = str(repo_root / "config.json")
    try:
        config = read_json(Path(config_path)) if config_path else {}
    except Exception:
        config = {}
    freecad = config.get("freecad") if isinstance(config.get("freecad"), dict) else {}
    return host or str(freecad.get("rpcHost") or "localhost"), int(port or freecad.get("rpcPort") or 9877)


def execute_freecad_code(host: str, port: int, code: str) -> dict[str, Any]:
    try:
        server = xmlrpc.client.ServerProxy(f"http://{host}:{port}", allow_none=True)
        result = server.execute_code(code)
    except Exception as exc:
        raise RuntimeError(f"Cannot connect to FreeCAD RPC server at {host}:{port}: {exc}") from exc
    if not isinstance(result, dict) or not result.get("success"):
        raise RuntimeError(f"FreeCAD RPC failed: {result!r}")
    text = str(result.get("message") or result.get("stdout") or "")
    candidates = [line.strip() for line in text.splitlines() if line.strip()]
    if "Output:" in text:
        candidates.insert(0, text.split("Output:", 1)[1].strip())
    for candidate in reversed(candidates):
        if not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise RuntimeError(f"FreeCAD RPC response did not contain JSON payload: {result!r}")

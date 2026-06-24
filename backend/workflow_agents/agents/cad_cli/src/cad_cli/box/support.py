"""Self-contained support functions for placeholder box builds."""

from __future__ import annotations

import json
import os
import xmlrpc.client
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def default_spec_path(workspace_dir: str | Path) -> Path:
    return Path(workspace_dir).expanduser().resolve() / "00_inputs/cad_build_spec.json"


def default_cad_dir(workspace_dir: str | Path) -> Path:
    return Path(workspace_dir).expanduser().resolve() / "01_cad"


def default_doc_name(workspace_dir: str | Path, prefix: str | None = None) -> str:
    path = Path(workspace_dir).expanduser().resolve()
    version = path.name
    workspace = path.parent.parent.name if path.parent.name == "versions" else path.name
    user = "user"
    parts = list(path.parts)
    if "users" in parts:
        index = parts.index("users")
        if index + 1 < len(parts):
            user = parts[index + 1]
    raw = "_".join(part for part in (prefix, user, workspace, version) if part)
    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw)
    return safe.strip("_") or "cad_document"


def load_spec(path: Path) -> dict[str, Any]:
    spec = read_json(path)
    if spec.get("schema_version") != "cad_build_spec/1.0":
        raise ValueError(f"{path} is not cad_build_spec/1.0")
    components = spec.get("components")
    if not isinstance(components, list) or not components:
        raise ValueError("cad_build_spec.components must be a non-empty list")
    return spec


def repo_root_from_box_dir(box_dir: Path) -> Path:
    return box_dir.resolve().parents[5]


def freecad_rpc_settings(
    host: str | None,
    port: int | None,
    *,
    repo_root: Path | None = None,
) -> tuple[str, int]:
    if host and port:
        return host, int(port)
    config_path = os.getenv("CODEX_WEB_CONFIG_PATH")
    if not config_path and repo_root is not None:
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
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise RuntimeError(f"FreeCAD RPC response did not contain JSON payload: {result!r}")


def normalize_runtime_path(path: Path) -> str:
    return str(Path(path).expanduser().resolve())


def common_imports() -> str:
    return r'''
import importlib
import importlib.util
import json
import sys
from pathlib import Path

import FreeCAD
import FreeCADGui
import Part

FREECAD_MODULE_DIR = __FREECAD_MODULE_DIR__
if FREECAD_MODULE_DIR not in sys.path:
    sys.path.insert(0, FREECAD_MODULE_DIR)
def load_module_from_path(module_name, module_path):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
freecad_runtime = load_module_from_path("freecad_runtime", str(Path(FREECAD_MODULE_DIR) / "freecad_runtime.py"))
from freecad_runtime import build_box, build_envelope, build_wall, fit_active_view, open_clean_document
'''


def freecad_base_script(*, extra_imports: str = "", constants: str = "", helpers: str = "", body: str) -> str:
    return "\n".join(
        part.strip("\n")
        for part in (
            common_imports(),
            extra_imports,
            constants,
            helpers,
            body,
        )
        if part.strip()
    )

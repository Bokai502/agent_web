"""Minimal runtime settings for FreeCAD CLI tools."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CODEX_WEB_CONFIG_PATH = Path(
    os.getenv(
        "CODEX_WEB_CONFIG_PATH",
        Path(__file__).resolve().parents[6] / "config.json",
    )
)
_CONFIG_CACHE: dict[str, Any] | None = None
_WORKSPACE_OVERRIDE: Path | None = None


def _load_codex_web_config() -> dict[str, Any]:
    """Return the codex-web config if it is available and valid."""
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE

    try:
        payload = json.loads(CODEX_WEB_CONFIG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        payload = {}

    _CONFIG_CACHE = payload if isinstance(payload, dict) else {}
    return _CONFIG_CACHE


def _get_freecad_config_value(key: str, default: str | None = None) -> str | None:
    config = _load_codex_web_config()
    freecad_config = config.get("freecad", {})
    workspace_config = config.get("workspace", {})

    value = None
    if isinstance(workspace_config, dict):
        value = workspace_config.get(key)
    if value is None and isinstance(freecad_config, dict):
        value = freecad_config.get(key)
    if value is None:
        return default
    if isinstance(value, str) and not value.strip():
        return default
    return str(value)


def _get_config_workspace_dir() -> str | None:
    return _get_freecad_config_value("workspaceDir")


def set_workspace_override(workspace: str | Path | None) -> Path | None:
    """Set a process-local workspace override used by CLI commands."""
    global _WORKSPACE_OVERRIDE
    if workspace is None:
        _WORKSPACE_OVERRIDE = None
        return None
    _WORKSPACE_OVERRIDE = Path(workspace).expanduser().resolve()
    return _WORKSPACE_OVERRIDE


def get_workspace_override() -> Path | None:
    """Return the process-local workspace override, if any."""
    return _WORKSPACE_OVERRIDE


FALLBACK_RPC_HOST = "localhost"
FALLBACK_RPC_PORT = _get_freecad_config_value("rpcPort", "9877")
FALLBACK_COMPONENT_INFO_MAX_STEP_SIZE_MB = "100"
CONFIG_WORKSPACE_DIR = _get_config_workspace_dir()
FREECAD_WORKSPACE_DIR = CONFIG_WORKSPACE_DIR
DEFAULT_CAD_INPUT_DIR = Path("./00_inputs")
DEFAULT_CAD_OUTPUT_DIR = Path("./01_cad")
DEFAULT_GEOMETRY_AFTER_STEM = "geometry_after"


def get_runtime_setting(key: str, default: str, config_key: str | None = None) -> str:
    """Return a runtime setting from environment, codex-web config, or fallback."""
    env_value = os.getenv(key)
    if env_value is not None and env_value.strip():
        return env_value
    if config_key is not None:
        config_value = _get_freecad_config_value(config_key)
        if config_value is not None:
            return config_value
    return default


def get_default_rpc_host() -> str:
    """Return the configured default RPC host."""
    return get_runtime_setting("FREECAD_RPC_HOST", FALLBACK_RPC_HOST, "rpcHost")


def get_default_rpc_port() -> int:
    """Return the configured default RPC port."""
    return int(get_runtime_setting("FREECAD_RPC_PORT", FALLBACK_RPC_PORT, "rpcPort"))


def get_default_workspace_dir() -> Path:
    """Return the workspace root from CLI override, environment, or codex-web config."""
    if _WORKSPACE_OVERRIDE is not None:
        return _WORKSPACE_OVERRIDE
    env_workspace = os.getenv("FREECAD_WORKSPACE_DIR")
    if env_workspace is not None and env_workspace.strip():
        return Path(env_workspace).expanduser().resolve()
    raw = _get_config_workspace_dir()
    if raw is None or not raw.strip():
        raise RuntimeError(
            "FreeCAD workspace is not configured. Pass --workspace, set "
            f"FREECAD_WORKSPACE_DIR, or configure workspace.workspaceDir in {CODEX_WEB_CONFIG_PATH} "
            "before running workspace-scoped commands."
        )
    return Path(raw).expanduser().resolve()


def get_default_component_info_max_step_size_mb() -> float:
    """Return the configured default max STEP size for component-info builds."""
    return float(
        get_runtime_setting(
            "FREECAD_COMPONENT_INFO_MAX_STEP_SIZE_MB",
            FALLBACK_COMPONENT_INFO_MAX_STEP_SIZE_MB,
            "componentInfoMaxStepSizeMb",
        )
    )


def resolve_workspace_path(path: str | Path) -> Path:
    """Resolve a path against the configured workspace root when it is relative."""
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return get_default_workspace_dir() / candidate


def get_default_layout_topology_path() -> Path:
    """Return the default layout_topology.json path."""
    return resolve_workspace_path(DEFAULT_CAD_INPUT_DIR / "layout_topology.json")


def get_default_geom_path() -> Path:
    """Return the default geom.json path."""
    return resolve_workspace_path(DEFAULT_CAD_INPUT_DIR / "geom.json")


def get_default_real_bom_path() -> Path:
    """Return the default real_bom.json path."""
    return resolve_workspace_path(DEFAULT_CAD_INPUT_DIR / "real_bom.json")


def get_default_cad_output_dir() -> Path:
    """Return the default output directory for CAD-stage artifacts."""
    return resolve_workspace_path(DEFAULT_CAD_OUTPUT_DIR)


def get_default_geometry_after_step_path() -> Path:
    """Return the default STEP output path for CLI-generated geometry."""
    return get_default_cad_output_dir() / f"{DEFAULT_GEOMETRY_AFTER_STEM}.step"


def resolve_geometry_after_step_path(path: str | Path | None = None) -> Path:
    """Resolve a STEP export target whose basename is always geometry_after.step."""
    if path is None:
        return get_default_geometry_after_step_path()

    candidate = resolve_workspace_path(path)
    if candidate.suffix:
        return candidate.with_name(f"{DEFAULT_GEOMETRY_AFTER_STEM}.step")
    return candidate / f"{DEFAULT_GEOMETRY_AFTER_STEM}.step"


def get_default_geometry_after_layout_topology_path() -> Path:
    """Return the default layout_topology output path for non-destructive edits."""
    return get_default_cad_output_dir() / f"{DEFAULT_GEOMETRY_AFTER_STEM}.layout_topology.json"


def get_default_geometry_after_geom_path() -> Path:
    """Return the default geom output path for non-destructive edits."""
    return get_default_cad_output_dir() / f"{DEFAULT_GEOMETRY_AFTER_STEM}.geom.json"


def get_default_artifact_registry_dir() -> Path:
    """Return the configured artifact registry directory."""
    raw = os.getenv("FREECAD_ARTIFACT_REGISTRY_DIR")
    if raw is not None and raw.strip():
        return Path(raw).expanduser().resolve()
    return get_default_workspace_dir() / "logs" / "registry"


DEFAULT_RPC_HOST = get_default_rpc_host()
DEFAULT_RPC_PORT = get_default_rpc_port()

"""FreeCAD document naming helpers."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from freecad_cli_tools.runtime_config import get_default_workspace_dir

DEFAULT_DOC_NAME = "LayoutAssembly"
DOC_NAME_PREFIX = "FC"
MAX_DOC_NAME_LENGTH = 120


def add_doc_name_arg(parser: Any, *, help_text: str | None = None) -> None:
    """Add a shared optional FreeCAD document name argument."""
    parser.add_argument(
        "--doc-name",
        default=None,
        help=help_text
        or (
            "FreeCAD document name. Defaults to FC_{workspaceId}_{versionId} "
            "for versioned workspaces, or LayoutAssembly when it cannot be inferred."
        ),
    )


def resolve_doc_name(explicit_doc_name: str | None = None) -> str:
    """Return the explicit doc name or infer one from the active workspace."""
    if explicit_doc_name is not None and explicit_doc_name.strip():
        return explicit_doc_name.strip()
    return infer_doc_name_from_workspace() or DEFAULT_DOC_NAME


def infer_doc_name_from_workspace(workspace_dir: str | Path | None = None) -> str | None:
    """Infer FC_{workspaceId}_{versionId} from a versioned workspace directory."""
    try:
        workspace_path = (
            Path(workspace_dir).expanduser().resolve()
            if workspace_dir is not None
            else get_default_workspace_dir()
        )
    except Exception:
        return None

    manifest_path = _find_workspace_manifest(workspace_path)
    if manifest_path is None:
        return None

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(manifest, dict):
        return None

    workspace_id = _string_value(manifest.get("workspaceId"))
    version_id = _version_id_for_workspace(manifest, workspace_path)
    if not workspace_id or not version_id:
        return None

    return _sanitize_doc_name(f"{DOC_NAME_PREFIX}_{workspace_id}_{version_id}")


def _find_workspace_manifest(workspace_path: Path) -> Path | None:
    for candidate_dir in (workspace_path, *workspace_path.parents):
        manifest_path = candidate_dir / "workspace_manifest.json"
        if manifest_path.exists():
            return manifest_path
    return None


def _version_id_for_workspace(manifest: dict[str, Any], workspace_path: Path) -> str | None:
    versions = manifest.get("versions")
    if isinstance(versions, list):
        for version in versions:
            if not isinstance(version, dict):
                continue
            version_workspace = _string_value(version.get("workspaceDir"))
            version_id = _string_value(version.get("id"))
            if not version_workspace or not version_id:
                continue
            try:
                if Path(version_workspace).expanduser().resolve() == workspace_path:
                    return version_id
            except OSError:
                continue

    active_version_id = _string_value(manifest.get("activeVersionId"))
    if active_version_id:
        root_dir = _string_value(manifest.get("rootDir"))
        if root_dir:
            try:
                expected = Path(root_dir).expanduser().resolve() / "versions" / active_version_id
                if expected == workspace_path:
                    return active_version_id
            except OSError:
                pass
        if workspace_path.name == active_version_id:
            return active_version_id

    if workspace_path.parent.name == "versions":
        return workspace_path.name
    return None


def _sanitize_doc_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", value).strip("_")
    cleaned = re.sub(r"_+", "_", cleaned)
    if not cleaned:
        return DEFAULT_DOC_NAME
    if not re.match(r"^[A-Za-z]", cleaned):
        cleaned = f"{DOC_NAME_PREFIX}_{cleaned}"
    return cleaned[:MAX_DOC_NAME_LENGTH] or DEFAULT_DOC_NAME


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None

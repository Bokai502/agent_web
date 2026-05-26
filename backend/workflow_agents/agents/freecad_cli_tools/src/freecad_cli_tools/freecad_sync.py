"""Helpers for syncing computed placements into FreeCAD over RPC."""

from __future__ import annotations

import json
from typing import Any

from .cli_support import execute_script_payload
from .rpc_script_fragments import PLACEMENT_HELPERS
from .rpc_script_loader import render_rpc_script


def normalize_position_list(value: Any, *, field_name: str, index: int) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"Sync update #{index} must include a 3-item '{field_name}' list.")
    return [float(item) for item in value]


def normalize_orientation_rows(value: Any, *, field_name: str, index: int) -> list[list[int]]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"Sync update #{index} must include a 3x3 '{field_name}' list.")
    rows = []
    for row in value:
        if not isinstance(row, list) or len(row) != 3:
            raise ValueError(f"Sync update #{index} must include a 3x3 '{field_name}' list.")
        rows.append([int(item) for item in row])
    return rows


def normalize_sync_updates(raw_updates: Any) -> list[dict[str, Any]]:
    """Validate and normalize placement updates for batch CAD sync."""
    if isinstance(raw_updates, dict):
        updates = raw_updates.get("updates", [])
    else:
        updates = raw_updates

    if not isinstance(updates, list) or not updates:
        raise ValueError(
            "Sync updates must be a non-empty list or an object with an 'updates' list."
        )

    normalized = []
    for index, item in enumerate(updates, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Sync update #{index} must be an object.")

        component_id = str(item.get("component") or item.get("component_id") or "").strip()
        if not component_id:
            raise ValueError(f"Sync update #{index} is missing 'component'.")

        normalized_update = {
            "component": component_id,
            "solid_name": item.get("solid_name") or item.get("component_object") or component_id,
            "part_name": item.get("part_name") or item.get("part_object") or f"{component_id}_part",
            "position": normalize_position_list(
                item.get("position"),
                field_name="position",
                index=index,
            ),
            "orientation_rows": normalize_orientation_rows(
                item.get("orientation_rows", item.get("rotation_matrix")),
                field_name="orientation_rows",
                index=index,
            ),
        }

        if "solid_position" in item:
            normalized_update["solid_position"] = normalize_position_list(
                item.get("solid_position"),
                field_name="solid_position",
                index=index,
            )
        if "solid_orientation_rows" in item or "solid_rotation_matrix" in item:
            normalized_update["solid_orientation_rows"] = normalize_orientation_rows(
                item.get("solid_orientation_rows", item.get("solid_rotation_matrix")),
                field_name="solid_orientation_rows",
                index=index,
            )
        if "source_position" in item:
            normalized_update["source_position"] = normalize_position_list(
                item.get("source_position"),
                field_name="source_position",
                index=index,
            )
        if "source_orientation_rows" in item or "source_rotation_matrix" in item:
            normalized_update["source_orientation_rows"] = normalize_orientation_rows(
                item.get("source_orientation_rows", item.get("source_rotation_matrix")),
                field_name="source_orientation_rows",
                index=index,
            )

        normalized.append(normalized_update)
    return normalized


def render_batch_sync_script(
    doc_name: str,
    updates: list[dict[str, Any]],
    *,
    recompute: bool = False,
    export_step_path: str | None = None,
) -> str:
    """Render the FreeCAD-side batch placement sync script."""
    return render_rpc_script(
        "sync_component_placements.py",
        {
            "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
            "__DOC_NAME__": json.dumps(doc_name),
            "__UPDATES__": json.dumps(updates),
            "__RECOMPUTE__": "True" if recompute else "False",
            "__EXPORT_STEP_PATH__": (
                json.dumps(export_step_path) if export_step_path is not None else "None"
            ),
        },
    )


def execute_batch_sync(
    host: str,
    port: int,
    doc_name: str,
    updates: list[dict[str, Any]],
    *,
    recompute: bool = False,
    export_step_path: str | None = None,
) -> dict[str, Any]:
    """Execute a batch placement sync against the target FreeCAD document."""
    code = render_batch_sync_script(
        doc_name,
        updates,
        recompute=recompute,
        export_step_path=export_step_path,
    )
    payload = execute_script_payload(host, port, code)
    if not payload.get("success"):
        raise RuntimeError(payload.get("error") or "CAD sync failed")
    return payload

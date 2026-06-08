"""Normalize layout_topology.json + geom.json + component info into a build spec."""

from __future__ import annotations

import csv
from copy import deepcopy
from pathlib import Path
from typing import Any

from freecad_cli_tools.geometry import FACE_DEFINITIONS, is_external_face
from freecad_cli_tools.layout_dataset_common import (
    LayoutDatasetError,
    bbox_size,
    require_string,
    vector3,
)
from freecad_cli_tools.layout_dataset_faces import (
    component_local_face_to_face_id,
    layout_mount_face_to_face_id,
)
from freecad_cli_tools.layout_dataset_io import load_json_file
from freecad_cli_tools.runtime_config import resolve_workspace_path


def load_and_normalize_component_info_assembly(
    layout_topology_path: str | Path,
    geom_path: str | Path,
    geom_component_info_path: str | Path | None = None,
    real_bom_path: str | Path | None = None,
    max_step_size_mb: float = 100.0,
) -> dict[str, Any]:
    layout_topology = load_json_file(layout_topology_path)
    geom = load_json_file(geom_path)
    if geom_component_info_path is not None and Path(geom_component_info_path).exists():
        geom_component_info = load_json_file(geom_component_info_path)
        source_path = geom_component_info_path
    elif real_bom_path is not None:
        real_bom = load_json_file(real_bom_path)
        geom_component_info = build_geom_component_info_from_real_bom(
            real_bom=real_bom,
            geom=geom,
            template_csv_base_path=real_bom_path,
        )
        source_path = real_bom_path
    else:
        raise FileNotFoundError("geom_component_info.json not found and real_bom.json was not provided.")
    return normalize_component_info_assembly(
        layout_topology=layout_topology,
        geom=geom,
        geom_component_info=geom_component_info,
        geom_component_info_path=source_path,
        max_step_size_mb=max_step_size_mb,
    )


def build_geom_component_info_from_real_bom(
    *,
    real_bom: dict[str, Any],
    geom: dict[str, Any],
    template_csv_base_path: str | Path | None = None,
) -> dict[str, Any]:
    if not isinstance(real_bom, dict):
        raise LayoutDatasetError("real_bom data must be a JSON object.")
    csv_path = _real_bom_template_csv_path(real_bom)
    csv_by_semantic_name = _template_csv_rows_by_device_id(csv_path) if csv_path else {}
    geom_by_component = _geom_components_by_component_id(geom)
    components = []
    for item in real_bom.get("items", []):
        if not isinstance(item, dict):
            continue
        component_id = item.get("component_id")
        if not isinstance(component_id, str) or not component_id.strip():
            continue
        geom_component = geom_by_component.get(component_id)
        if not isinstance(geom_component, dict):
            continue
        entry: dict[str, Any] = {
            "component_id": component_id,
            "category": item.get("category") or geom_component.get("category"),
            "position": geom_component.get("position"),
            "dims": geom_component.get("dims") or item.get("size_mm"),
        }
        color = geom_component.get("color")
        if isinstance(color, list):
            entry["color"] = color
        source_ref = item.get("source_ref") if isinstance(item.get("source_ref"), dict) else {}
        step_path = _step_path_from_source_ref(source_ref, csv_path)
        semantic_name = item.get("semantic_name")
        row = csv_by_semantic_name.get(semantic_name) if isinstance(semantic_name, str) else None
        if not step_path and row:
            step_path = _step_path_from_template_row(row, csv_path)
        if step_path:
            entry["display_info"] = {"assets": {"cad_rotated_path": step_path}}
        components.append(entry)
    return {
        "schema_version": "1.0",
        "source": {
            "kind": "real_bom_template_csv",
            "template_csv": str(csv_path) if csv_path else None,
            "template_csv_base_path": str(template_csv_base_path) if template_csv_base_path else None,
        },
        "components": components,
    }


def normalize_component_info_assembly(
    *,
    layout_topology: dict[str, Any],
    geom: dict[str, Any],
    geom_component_info: dict[str, Any],
    geom_component_info_path: str | Path,
    max_step_size_mb: float = 100.0,
) -> dict[str, Any]:
    if not isinstance(layout_topology, dict):
        raise LayoutDatasetError("layout_topology data must be a JSON object.")
    if not isinstance(geom, dict):
        raise LayoutDatasetError("geom data must be a JSON object.")
    if not isinstance(geom_component_info, dict):
        raise LayoutDatasetError("geom_component_info data must be a JSON object.")

    outer_shell = geom.get("outer_shell")
    if not isinstance(outer_shell, dict):
        raise LayoutDatasetError("geom.outer_shell must be a JSON object.")

    placement_by_component = _placements_by_component_id(layout_topology)
    geom_components = geom.get("components")
    if geom_components is not None and not isinstance(geom_components, dict):
        raise LayoutDatasetError("geom.components must be a JSON object when present.")

    max_step_size_bytes = _step_size_limit_bytes(max_step_size_mb)
    normalized_components: dict[str, Any] = {}
    for entry in _component_info_entries(geom_component_info):
        component_id = require_string(entry.get("component_id"), "component.component_id")
        placement = placement_by_component.get(component_id)
        if not isinstance(placement, dict):
            raise LayoutDatasetError(
                f"layout_topology.placements is missing component_id={component_id!r}."
            )
        geom_component = _resolve_geom_component(geom_components, component_id)
        target_bbox = _resolve_target_bbox(entry, geom_component, component_id)
        mount_face_id = require_string(
            placement.get("mount_face_id"),
            f"placement[{component_id!r}].mount_face_id",
        )
        component_mount_face_id = require_string(
            placement.get("component_mount_face_id"),
            f"placement[{component_id!r}].component_mount_face_id",
        )
        install_face = layout_mount_face_to_face_id(mount_face_id)
        component_local_face = component_local_face_to_face_id(component_mount_face_id)
        _, mount_axis, mount_direction = FACE_DEFINITIONS[install_face]
        requested_step_path = _requested_step_path(entry)
        step_path, step_size_bytes, step_fallback_reason = _resolve_step_path(
            requested_step_path,
            max_step_size_bytes=max_step_size_bytes,
        )
        color = _resolve_color(entry, geom_component)
        normalized_components[component_id] = {
            "id": component_id,
            "component_id": component_id,
            "category": _resolve_category(entry, geom_component),
            "color": color,
            "target_bbox": target_bbox,
            "target_size": bbox_size(target_bbox, f"components[{component_id!r}].target_bbox"),
            "placement": {
                "mount_face_id": mount_face_id,
                "component_mount_face_id": component_mount_face_id,
                "alignment": deepcopy(placement.get("alignment") or {}),
                "install_face": install_face,
                "component_local_face": component_local_face,
                "mount_axis": mount_axis,
                "mount_direction": mount_direction,
                "external": bool(is_external_face(install_face)),
            },
            "source": {
                "kind": "step" if step_path is not None else "box",
                "step_path": str(step_path) if step_path is not None else None,
                "requested_step_path": requested_step_path,
                "step_size_bytes": step_size_bytes,
                "fallback_reason": step_fallback_reason,
                "geom_component_info_path": str(Path(geom_component_info_path).resolve()),
            },
        }

    if not normalized_components:
        raise LayoutDatasetError(
            "geom_component_info.components must contain at least one component."
        )

    return {
        "schema_version": "geom_component_assembly/1.0",
        "source": {
            "layout_id": layout_topology.get("layout_id"),
            "source_design_id": layout_topology.get("source_design_id"),
            "topology_schema_version": layout_topology.get("schema_version"),
            "geom_schema_version": geom.get("schema_version"),
            "geom_component_info_schema_version": geom_component_info.get("schema_version"),
        },
        "envelope": {
            "outer_size": bbox_size(outer_shell.get("outer_bbox"), "geom.outer_shell.outer_bbox"),
            "inner_size": bbox_size(outer_shell.get("inner_bbox"), "geom.outer_shell.inner_bbox"),
            "outer_min": vector3(
                outer_shell.get("outer_bbox", {}).get("min"),
                "geom.outer_shell.outer_bbox.min",
            ),
            "outer_max": vector3(
                outer_shell.get("outer_bbox", {}).get("max"),
                "geom.outer_shell.outer_bbox.max",
            ),
            "inner_min": vector3(
                outer_shell.get("inner_bbox", {}).get("min"),
                "geom.outer_shell.inner_bbox.min",
            ),
            "inner_max": vector3(
                outer_shell.get("inner_bbox", {}).get("max"),
                "geom.outer_shell.inner_bbox.max",
            ),
            "shell_thickness": float(outer_shell.get("thickness") or 0.0),
        },
        "components": normalized_components,
    }


def _placements_by_component_id(layout_topology: dict[str, Any]) -> dict[str, dict[str, Any]]:
    placements = layout_topology.get("placements")
    if not isinstance(placements, list) or not placements:
        raise LayoutDatasetError("layout_topology.placements must be a non-empty array.")
    result: dict[str, dict[str, Any]] = {}
    for placement in placements:
        if not isinstance(placement, dict):
            raise LayoutDatasetError("Each placement must be a JSON object.")
        component_id = require_string(placement.get("component_id"), "placement.component_id")
        result[component_id] = placement
    return result


def _component_info_entries(geom_component_info: dict[str, Any]) -> list[dict[str, Any]]:
    components = geom_component_info.get("components")
    if isinstance(components, list):
        return [entry for entry in components if isinstance(entry, dict)]
    if isinstance(components, dict):
        return [
            {"component_id": key, **value}
            for key, value in components.items()
            if isinstance(key, str) and isinstance(value, dict)
        ]
    raise LayoutDatasetError("geom_component_info.components must be an array or object.")


def _real_bom_template_csv_path(real_bom: dict[str, Any]) -> Path | None:
    source = real_bom.get("source")
    raw_path = source.get("template_csv") if isinstance(source, dict) else None
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    return resolve_workspace_path(raw_path)


def _template_csv_rows_by_device_id(csv_path: Path | None) -> dict[str, dict[str, str]]:
    if csv_path is None or not csv_path.exists():
        return {}
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        rows = {}
        for row in reader:
            device_id = row.get("器件ID")
            if isinstance(device_id, str) and device_id.strip():
                rows[device_id.strip()] = row
        return rows


def _step_path_from_template_row(row: dict[str, str] | None, csv_path: Path | None) -> str | None:
    if not row:
        return None
    for field in ("CAD_rotated_path", "CAD_MAJOR_PATH", "Rotated CAD Path", "CAD路径"):
        raw_path = row.get(field)
        resolved = _resolve_template_step_path(raw_path, csv_path)
        if resolved is not None:
            return str(resolved)
    return None


def _step_path_from_source_ref(source_ref: dict[str, Any], csv_path: Path | None) -> str | None:
    for field in ("cad_rotated_path", "cad_major_path", "cad_path", "CAD_ROTATED_PATH", "CAD_MAJOR_PATH"):
        raw_path = source_ref.get(field)
        resolved = _resolve_template_step_path(raw_path, csv_path)
        if resolved is not None:
            return str(resolved)
    return None


def _resolve_template_step_path(raw_path: str | None, csv_path: Path | None) -> Path | None:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    candidate = Path(raw_path.strip())
    candidates = []
    if candidate.is_absolute():
        candidates.append(candidate)
    else:
        if csv_path is not None:
            candidates.extend([csv_path.parent / candidate, csv_path.parent.parent / candidate])
            if len(candidate.parts) > 1:
                candidates.append(csv_path.parent.parent / Path(*candidate.parts[1:]))
            candidates.append(csv_path.parent.parent.parent / candidate)
        try:
            candidates.append(resolve_workspace_path(candidate))
        except RuntimeError:
            pass
    for path in candidates:
        if path.exists() and path.suffix.lower() in {".step", ".stp"}:
            return path.resolve()
    return None


def _geom_components_by_component_id(geom: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    components = geom.get("components")
    if not isinstance(components, dict):
        return result
    for key, value in components.items():
        if not isinstance(value, dict):
            continue
        component_id = value.get("component_id") or value.get("id") or key
        if isinstance(component_id, str):
            result[component_id] = value
    return result


def _resolve_geom_component(
    geom_components: dict[str, Any] | None,
    component_id: str,
) -> dict[str, Any] | None:
    if not isinstance(geom_components, dict):
        return None
    direct = geom_components.get(component_id)
    if isinstance(direct, dict):
        return direct
    matches = [
        value
        for value in geom_components.values()
        if isinstance(value, dict)
        and (value.get("component_id") == component_id or value.get("id") == component_id)
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def _resolve_target_bbox(
    entry: dict[str, Any],
    geom_component: dict[str, Any] | None,
    component_id: str,
) -> dict[str, list[float]]:
    bbox = entry.get("bbox")
    if isinstance(bbox, dict):
        return {
            "min": vector3(bbox.get("min"), f"geom_component_info[{component_id!r}].bbox.min"),
            "max": vector3(bbox.get("max"), f"geom_component_info[{component_id!r}].bbox.max"),
        }

    position = entry.get("position")
    dims = entry.get("dims", entry.get("size"))
    if position is not None and dims is not None:
        bbox_min = vector3(position, f"geom_component_info[{component_id!r}].position")
        bbox_dims = vector3(dims, f"geom_component_info[{component_id!r}].dims")
        return {
            "min": bbox_min,
            "max": [bbox_min[index] + bbox_dims[index] for index in range(3)],
        }

    if isinstance(geom_component, dict):
        bbox_min = geom_component.get("position")
        bbox_dims = geom_component.get("dims")
        if bbox_min is not None and bbox_dims is not None:
            parsed_min = vector3(bbox_min, f"geom.components[{component_id!r}].position")
            parsed_dims = vector3(bbox_dims, f"geom.components[{component_id!r}].dims")
            return {
                "min": parsed_min,
                "max": [parsed_min[index] + parsed_dims[index] for index in range(3)],
            }

    raise LayoutDatasetError(
        f"Component {component_id!r} requires bbox or position+dims in geom_component_info.json."
    )


def _resolve_category(entry: dict[str, Any], geom_component: dict[str, Any] | None) -> str | None:
    value = entry.get("category")
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(geom_component, dict):
        fallback = geom_component.get("category")
        if isinstance(fallback, str) and fallback.strip():
            return fallback.strip()
    return None


def _resolve_color(
    entry: dict[str, Any],
    geom_component: dict[str, Any] | None,
) -> list[int] | None:
    for candidate in (
        entry.get("color"),
        geom_component.get("color") if isinstance(geom_component, dict) else None,
    ):
        if isinstance(candidate, list) and 3 <= len(candidate) <= 4:
            return [int(value) for value in candidate]
    return None


def _requested_step_path(entry: dict[str, Any]) -> str | None:
    display_info = entry.get("display_info")
    assets = display_info.get("assets") if isinstance(display_info, dict) else None
    step_path = assets.get("cad_rotated_path") if isinstance(assets, dict) else None
    if not isinstance(step_path, str) or not step_path.strip():
        return None
    return step_path


def _step_size_limit_bytes(max_step_size_mb: float) -> int | None:
    if max_step_size_mb < 0:
        return None
    return int(max_step_size_mb * 1024 * 1024)


def _resolve_step_path(
    requested: str | None,
    *,
    max_step_size_bytes: int | None,
) -> tuple[Path | None, int | None, str | None]:
    if requested is None:
        return None, None, "missing_step_path"
    resolved = resolve_workspace_path(requested)
    if not resolved.exists():
        return None, None, "missing_file"
    if resolved.suffix.lower() not in {".step", ".stp"}:
        return None, None, "unsupported_extension"
    size_bytes = resolved.stat().st_size
    if max_step_size_bytes is not None and size_bytes > max_step_size_bytes:
        return None, size_bytes, "file_too_large"
    return resolved, size_bytes, None


__all__ = [
    "LayoutDatasetError",
    "build_geom_component_info_from_real_bom",
    "load_and_normalize_component_info_assembly",
    "normalize_component_info_assembly",
]

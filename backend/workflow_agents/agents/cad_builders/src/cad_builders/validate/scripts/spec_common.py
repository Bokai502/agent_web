"""Shared helpers for CAD-native spec workflow scripts."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
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


def workspace_path(workspace_dir: str | Path, relative: str | Path) -> Path:
    base = Path(workspace_dir).expanduser().resolve()
    candidate = Path(relative)
    return candidate if candidate.is_absolute() else base / candidate


def default_spec_path(workspace_dir: str | Path) -> Path:
    return workspace_path(workspace_dir, "00_inputs/cad_build_spec.json")


def default_cad_dir(workspace_dir: str | Path) -> Path:
    return workspace_path(workspace_dir, "01_cad")


def load_spec(path: Path) -> dict[str, Any]:
    spec = read_json(path)
    if spec.get("schema_version") != "cad_build_spec/1.0":
        raise ValueError(f"{path} is not cad_build_spec/1.0")
    components = spec.get("components")
    if not isinstance(components, list) or not components:
        raise ValueError("cad_build_spec.components must be a non-empty list")
    return spec


def bbox_from_position_dims(position: list[float], dims: list[float]) -> dict[str, list[float]]:
    return {"min": position, "max": [position[index] + dims[index] for index in range(3)]}


def component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    bbox = component.get("bbox")
    if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        return {
            "min": [float(value) for value in bbox["min"]],
            "max": [float(value) for value in bbox["max"]],
        }
    return bbox_from_position_dims(vector3(component.get("position"), "component.position"), vector3(component.get("dims"), "component.dims"))


def vector3(value: Any, field_name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{field_name} must be a 3-item list")
    return [float(item) for item in value]


def spec_to_layout_data(spec: dict[str, Any], *, simulation_only: bool = False, include_walls: bool = True) -> dict[str, Any]:
    envelope = spec.get("envelope") or {}
    components: dict[str, Any] = {}
    for component in spec.get("components") or []:
        thermal = component.get("thermal") if isinstance(component.get("thermal"), dict) else {}
        if simulation_only and not bool(thermal.get("include_in_simulation")):
            continue
        component_id = str(component.get("id") or component.get("component_id"))
        components[component_id] = {
            "id": component_id,
            "component_id": component_id,
            "shape": component.get("shape", "box"),
            "dims": vector3(component.get("dims"), f"{component_id}.dims"),
            "color": component.get("color"),
            "mass": thermal.get("mass_kg"),
            "power": thermal.get("power_W"),
            "kind": component.get("kind"),
            "category": component.get("category"),
            "semantic_name": component.get("semantic_name"),
            "display_name": component.get("display_name"),
            "placement": {
                "position": vector3(component.get("position"), f"{component_id}.position"),
                "rotation_matrix": component.get("rotation_rows") or [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            },
        }
    return {
        "schema_version": "layout_dataset_normalized/1.0",
        "units": spec.get("units") or {"length": "mm"},
        "source": {"spec_schema_version": spec.get("schema_version")},
        "envelope": {
            "outer_bbox": envelope.get("outer_bbox"),
            "inner_bbox": envelope.get("inner_bbox"),
            "outer_size": envelope.get("outer_size") or _bbox_size(envelope.get("outer_bbox")),
            "inner_size": envelope.get("inner_size") or _bbox_size(envelope.get("inner_bbox")),
            "shell_thickness": envelope.get("shell_thickness", 0),
        },
        "cabins": spec.get("cabins") or [],
        "walls": spec.get("walls") if include_walls else [],
        "components": components,
    }


def _bbox_size(bbox: Any) -> list[float] | None:
    if not isinstance(bbox, dict):
        return None
    bbox_min = bbox.get("min")
    bbox_max = bbox.get("max")
    if not isinstance(bbox_min, list) or not isinstance(bbox_max, list) or len(bbox_min) != 3 or len(bbox_max) != 3:
        return None
    return [float(bbox_max[index]) - float(bbox_min[index]) for index in range(3)]


def print_result(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


@dataclass
class OutputCheck:
    path: Path
    exists: bool
    size_bytes: int


def check_file(path: Path) -> OutputCheck:
    exists = path.exists()
    return OutputCheck(path=path, exists=exists, size_bytes=path.stat().st_size if exists else 0)

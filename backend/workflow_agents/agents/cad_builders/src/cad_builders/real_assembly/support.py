"""Self-contained support functions for supplemental real assembly builds."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from cad_builders.common import (
    default_cad_dir,
    default_doc_name,
    default_spec_path,
    execute_freecad_code,
    load_spec,
    normalize_runtime_path,
    write_json,
)


FACE_DEFINITIONS = {
    0: ("-x", 0, -1),
    1: ("x", 0, 1),
    2: ("-y", 1, -1),
    3: ("y", 1, 1),
    4: ("-z", 2, -1),
    5: ("z", 2, 1),
    6: ("ext-x", 0, -1),
    7: ("ext+x", 0, 1),
    8: ("ext-y", 1, -1),
    9: ("ext+y", 1, 1),
    10: ("ext-z", 2, -1),
    11: ("ext+z", 2, 1),
}


def bbox_from_position_dims(position: list[float], dims: list[float]) -> dict[str, list[float]]:
    return {"min": position, "max": [position[index] + dims[index] for index in range(3)]}


def vector3(value: Any, field_name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{field_name} must be a 3-item list")
    return [float(item) for item in value]


def component_bbox(component: dict[str, Any]) -> dict[str, list[float]]:
    bbox = component.get("bbox")
    if isinstance(bbox, dict) and isinstance(bbox.get("min"), list) and isinstance(bbox.get("max"), list):
        return {
            "min": [float(value) for value in bbox["min"]],
            "max": [float(value) for value in bbox["max"]],
        }
    return bbox_from_position_dims(
        vector3(component.get("position"), "component.position"),
        vector3(component.get("dims"), "component.dims"),
    )


def is_external_face(face_id: int) -> bool:
    return int(face_id) >= 6


def freecad_rpc_settings(host: str | None, port: int | None) -> tuple[str, int]:
    from cad_builders.common import freecad_rpc_settings as shared_settings

    return shared_settings(host, port, start_path=Path(__file__).resolve())


def load_rpc_script(script_name: str, *, module_dir: Path) -> str:
    return (module_dir / "rpc_scripts" / script_name).read_text(encoding="utf-8")


def render_rpc_script(script_name: str, replacements: Mapping[str, str], *, module_dir: Path) -> str:
    content = load_rpc_script(script_name, module_dir=module_dir)
    for key, value in replacements.items():
        content = content.replace(key, value)
    return content


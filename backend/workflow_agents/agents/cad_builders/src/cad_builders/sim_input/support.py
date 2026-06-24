"""Self-contained support functions for CAD simulation input builds."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from cad_builders.common import (
    default_cad_dir,
    default_doc_name,
    default_spec_path,
    execute_freecad_code,
    load_spec,
    normalize_runtime_path,
    read_json,
    write_json,
)

def bbox_from_position_dims(position: list[float], dims: list[float]) -> dict[str, list[float]]:
    return {"min": position, "max": [position[index] + dims[index] for index in range(3)]}


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


def vector3(value: Any, field_name: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{field_name} must be a 3-item list")
    return [float(item) for item in value]


def positive_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed) or parsed <= 0:
        return None
    return parsed


def _bbox_size(bbox: Any) -> list[float] | None:
    if not isinstance(bbox, dict):
        return None
    bbox_min = bbox.get("min")
    bbox_max = bbox.get("max")
    if not isinstance(bbox_min, list) or not isinstance(bbox_max, list) or len(bbox_min) != 3 or len(bbox_max) != 3:
        return None
    return [float(bbox_max[index]) - float(bbox_min[index]) for index in range(3)]


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


def face_token(face_id: Any) -> str:
    token = str(face_id or "").split(".")[-1]
    return token.replace("local_", "")


def component_mount_face(face_id: Any) -> dict[str, Any]:
    token = face_token(face_id)
    axis = {"x": 0, "y": 1, "z": 2}.get(token[:1], 2)
    sign = -1 if token.endswith("min") else 1
    other_axes = [item for item in (0, 1, 2) if item != axis]
    return {
        "local_face": token,
        "normal_axis": axis,
        "normal_sign": sign,
        "u_axis": other_axes[0],
        "v_axis": other_axes[1],
    }


def default_alignment(component: dict[str, Any], mount: dict[str, Any]) -> dict[str, Any]:
    alignment = mount.get("alignment") if isinstance(mount.get("alignment"), dict) else component.get("alignment")
    if isinstance(alignment, dict) and alignment:
        return {
            "normal_alignment": alignment.get("normal_alignment", "opposite"),
            "component_u_axis_to_target_u_axis": bool(alignment.get("component_u_axis_to_target_u_axis", True)),
            "in_plane_rotation_deg": float(alignment.get("in_plane_rotation_deg", 0) or 0),
        }
    return {
        "normal_alignment": "opposite",
        "component_u_axis_to_target_u_axis": True,
        "in_plane_rotation_deg": 0,
    }


def install_face_from_id(face_id: str, envelope: dict[str, Any]) -> dict[str, Any]:
    owner_id, token = face_id.split(".", 1) if "." in face_id else (face_id, "zmax_inner")
    direction, side = token.split("_", 1) if "_" in token else (token, "inner")
    axis = {"x": 0, "y": 1, "z": 2}.get(direction[:1], 2)
    sign = -1 if direction.endswith("min") else 1
    bbox = envelope.get("inner_bbox") if side == "inner" else envelope.get("outer_bbox")
    if not isinstance(bbox, dict):
        bbox = {}
    bmin = bbox.get("min") if isinstance(bbox.get("min"), list) else [0.0, 0.0, 0.0]
    bmax = bbox.get("max") if isinstance(bbox.get("max"), list) else [0.0, 0.0, 0.0]
    plane_value = float(bmin[axis] if sign < 0 else bmax[axis])
    center = [(float(bmin[index]) + float(bmax[index])) / 2.0 for index in range(3)]
    center[axis] = plane_value
    extents = [float(bmax[index]) - float(bmin[index]) for index in range(3)]
    extents[axis] = 0.0
    axes_2d = [index for index in (0, 1, 2) if index != axis]
    return {
        "face_id": face_id,
        "id": face_id,
        "owner_id": owner_id,
        "side": side,
        "face_role": "panel_mount",
        "plane_axis": axis,
        "plane_value": plane_value,
        "normal_sign": sign,
        "belongs_to": "panel" if side == "inner" else owner_id,
        "panel_id": owner_id,
        "panel_name": owner_id,
        "cabin_face_tag": direction,
        "center_xyz": center,
        "extents_xyz": extents,
        "bbox_2d": [
            float(bmin[axes_2d[0]]),
            float(bmax[axes_2d[0]]),
            float(bmin[axes_2d[1]]),
            float(bmax[axes_2d[1]]),
        ],
    }


def shell_id_from_spec(spec: dict[str, Any]) -> str:
    envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
    for key in ("shell_id", "id", "owner_id"):
        value = envelope.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    parents = [
        cabin.get("parent")
        for cabin in spec.get("cabins") or []
        if isinstance(cabin, dict) and isinstance(cabin.get("parent"), str) and cabin.get("parent").strip()
    ]
    unique = sorted(set(parents))
    if len(unique) == 1:
        return unique[0]
    document = spec.get("document") if isinstance(spec.get("document"), dict) else {}
    value = document.get("shell_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return "outer_shell"


def shell_outer_face_ids(spec: dict[str, Any]) -> list[str]:
    shell_id = shell_id_from_spec(spec)
    return [f"{shell_id}.{direction}_outer" for direction in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")]


def install_faces_from_spec(spec: dict[str, Any]) -> list[dict[str, Any]]:
    envelope = spec.get("envelope") if isinstance(spec.get("envelope"), dict) else {}
    face_ids = sorted(
        {
            str((component.get("mount") or {}).get("install_face_id"))
            for component in spec.get("components") or []
            if (component.get("mount") or {}).get("install_face_id")
        }
    )
    face_ids.extend(shell_outer_face_ids(spec))
    return [install_face_from_id(face_id, envelope) for face_id in face_ids]


def build_simulation_input(spec: dict[str, Any], *, step_filename: str = "geometry_after_power_filtered.step") -> dict[str, Any]:
    components = []
    skipped = []
    install_faces = install_faces_from_spec(spec)
    install_face_ids = {item["face_id"] for item in install_faces}
    for component in spec.get("components") or []:
        component_id = str(component.get("id") or component.get("component_id"))
        thermal = component.get("thermal") if isinstance(component.get("thermal"), dict) else {}
        mount = component.get("mount") if isinstance(component.get("mount"), dict) else {}
        power = positive_number(thermal.get("power_W"))
        if not bool(thermal.get("include_in_simulation")) or power is None:
            skipped.append({"component_id": component_id, "reason": "not included in simulation", "power_W": thermal.get("power_W")})
            continue
        component_mount_face_id = mount.get("component_face_id")
        mount_face_id = mount.get("install_face_id")
        if mount_face_id and mount_face_id not in install_face_ids:
            install_faces.append(install_face_from_id(str(mount_face_id), spec.get("envelope") or {}))
            install_face_ids.add(str(mount_face_id))
        components.append({
            "component_id": component_id,
            "semantic_name": component.get("semantic_name"),
            "display_name": component.get("display_name"),
            "kind": component.get("kind"),
            "category": component.get("category"),
            "geometry_id": component.get("geometry_id") or component_id,
            "thermal_id": component.get("thermal_id"),
            "component_mount_face_id": component_mount_face_id,
            "component_mount_face": component_mount_face(component_mount_face_id),
            "mount_face_id": mount_face_id,
            "alignment": default_alignment(component, mount),
            "is_heat_source": True,
            "power_W": power,
            "mass_kg": float(thermal.get("mass_kg") or 0),
            "material_id": thermal.get("material_id") or "aluminum_6061",
            "bbox": component_bbox(component),
            "contact_resistance": float(thermal.get("contact_resistance") or 0.001),
        })
    walls = []
    for wall in spec.get("walls") or []:
        wall_id = wall.get("id")
        bbox = wall.get("bbox") if isinstance(wall.get("bbox"), dict) else {}
        bbox_min = bbox.get("min") if isinstance(bbox.get("min"), list) else None
        bbox_max = bbox.get("max") if isinstance(bbox.get("max"), list) else None
        thickness = None
        if bbox_min is not None and bbox_max is not None and len(bbox_min) == 3 and len(bbox_max) == 3:
            thickness = min(abs(float(bbox_max[index]) - float(bbox_min[index])) for index in range(3))
        walls.append({
            "wall_id": wall_id,
            "component_id": wall_id,
            "name": wall.get("name"),
            "panel_id": wall.get("panel_id"),
            "bbox": bbox,
            "thickness": thickness,
            "thickness_mm": thickness,
            "is_heat_source": False,
            "power_W": 0.0,
            "selection_role": "internal_partition",
        })
    return {
        "schema_version": "1.0",
        "simulation_input_id": f"{(spec.get('document') or {}).get('name', 'cad')}_simulation_input",
        "step_file": step_filename,
        "source_files": {"cad_build_spec": "../00_inputs/cad_build_spec.json"},
        "units": {"length": "mm", "power": "W", "contact_resistance": "m^2*K/W"},
        "components": components,
        "install_faces": install_faces,
        "shells": [{"shell_id": "outer_shell", "selection_role": "outer_shell"}],
        "walls": walls,
        "skipped_components": skipped,
        "cabins": spec.get("cabins") or [],
        "radiators": [item["component_id"] for item in components if item.get("kind") == "radiator"],
        "selection_plan": {
            "component_selections": [
                {
                    "selection_id": f"sel_{item['component_id']}",
                    "component_id": item["component_id"],
                    "semantic_name": item.get("semantic_name") or item["component_id"],
                    "step_name": item["component_id"],
                }
                for item in components
            ],
            "install_face_selections": [
                {"selection_id": f"sel_f_{str(face['face_id']).replace('.', '_')}", "face_id": face["face_id"]}
                for face in install_faces
            ],
            "wall_selections": [
                {"selection_id": f"sel_wall_{str(wall.get('wall_id')).replace('.', '_')}", "wall_id": wall.get("wall_id")}
                for wall in walls
            ],
            "shell_selections": [],
        },
    }


def freecad_rpc_settings(host: str | None, port: int | None) -> tuple[str, int]:
    from cad_builders.common import freecad_rpc_settings as shared_settings

    return shared_settings(host, port, start_path=Path(__file__).resolve())


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

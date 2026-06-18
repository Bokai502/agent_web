"""Shared helpers for CAD-native spec workflow scripts."""

from __future__ import annotations

import json
import math
import os
import sys
import xmlrpc.client
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[5]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


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
            "component_selections": [{"selection_id": f"sel_{item['component_id']}", "component_id": item["component_id"], "semantic_name": item.get("semantic_name") or item["component_id"], "step_name": item["component_id"]} for item in components],
            "install_face_selections": [{"selection_id": f"sel_f_{str(face['face_id']).replace('.', '_')}", "face_id": face["face_id"]} for face in install_faces],
            "wall_selections": [{"selection_id": f"sel_wall_{str(wall.get('wall_id')).replace('.', '_')}", "wall_id": wall.get("wall_id")} for wall in walls],
            "shell_selections": [],
        },
    }


def freecad_rpc_settings(host: str | None, port: int | None) -> tuple[str, int]:
    if host and port:
        return host, int(port)
    config_path = os.getenv("CODEX_WEB_CONFIG_PATH") or str(REPO_ROOT / "config.json")
    try:
        config = read_json(Path(config_path))
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

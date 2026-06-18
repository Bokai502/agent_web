#!/usr/bin/env python3
"""Build geometry_after_power_filtered.step and simulation_input.json from cad_build_spec.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from spec_common import build_simulation_input, default_cad_dir, default_doc_name, default_spec_path, execute_freecad_code, freecad_rpc_settings, load_spec, print_result, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build power-filtered simulation STEP from cad_build_spec.json.")
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--spec")
    parser.add_argument("--output-dir")
    parser.add_argument("--doc-name")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    return parser.parse_args()


FREECAD_SCRIPT = r'''
import json
import sys
from pathlib import Path

import FreeCAD
import FreeCADGui
import Import
import Part

INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
STEP_PATH = __STEP_PATH__

def matrix_to_rotation(rows):
    matrix = FreeCAD.Matrix()
    matrix.A11, matrix.A12, matrix.A13, matrix.A14 = float(rows[0][0]), float(rows[0][1]), float(rows[0][2]), 0
    matrix.A21, matrix.A22, matrix.A23, matrix.A24 = float(rows[1][0]), float(rows[1][1]), float(rows[1][2]), 0
    matrix.A31, matrix.A32, matrix.A33, matrix.A34 = float(rows[2][0]), float(rows[2][1]), float(rows[2][2]), 0
    matrix.A41, matrix.A42, matrix.A43, matrix.A44 = 0, 0, 0, 1
    return FreeCAD.Placement(matrix).Rotation

def build_box(doc, name, position, dims, rotation_rows):
    obj = doc.addObject("Part::Box", name)
    obj.Length, obj.Width, obj.Height = [float(v) for v in dims]
    placement = FreeCAD.Placement()
    placement.Base = FreeCAD.Vector(*[float(v) for v in position])
    placement.Rotation = matrix_to_rotation(rotation_rows or [[1,0,0],[0,1,0],[0,0,1]])
    obj.Placement = placement
    return obj

def build_envelope(doc, data):
    envelope = data.get("envelope") or {}
    outer_bbox = envelope.get("outer_bbox") or {}
    inner_bbox = envelope.get("inner_bbox") or {}
    outer_min = outer_bbox.get("min")
    outer_max = outer_bbox.get("max")
    inner_min = inner_bbox.get("min")
    inner_max = inner_bbox.get("max")
    if not outer_min or not outer_max or not inner_min or not inner_max:
        return None
    outer_size = [float(outer_max[i]) - float(outer_min[i]) for i in range(3)]
    inner_size = [float(inner_max[i]) - float(inner_min[i]) for i in range(3)]
    outer_shape = Part.makeBox(*outer_size, FreeCAD.Vector(*[float(v) for v in outer_min]))
    inner_shape = Part.makeBox(*inner_size, FreeCAD.Vector(*[float(v) for v in inner_min]))
    obj = doc.addObject("Part::Feature", "EnvelopeShell")
    obj.Shape = outer_shape.cut(inner_shape)
    return obj

def build_wall(doc, wall):
    wall_id = str(wall.get("id") or wall.get("wall_id") or wall.get("name") or "Wall")
    dims = wall.get("dims") or wall.get("size")
    position = wall.get("position")
    if not dims or not position:
        bbox = wall.get("bbox") or {}
        bbox_min = bbox.get("min")
        bbox_max = bbox.get("max")
        if not bbox_min or not bbox_max:
            return None
        position = [float(v) for v in bbox_min]
        dims = [float(bbox_max[i]) - float(bbox_min[i]) for i in range(3)]
    if any(float(v) <= 0.0 for v in dims):
        return None
    return build_box(doc, wall_id, position, dims, [[1,0,0],[0,1,0],[0,0,1]])

def simulation_components(data):
    raw_components = data.get("components") or []
    if isinstance(raw_components, dict):
        raw_components = list(raw_components.values())
    result = []
    for component in raw_components:
        thermal = component.get("thermal") if isinstance(component.get("thermal"), dict) else {}
        power = thermal.get("power_W")
        try:
            include = bool(thermal.get("include_in_simulation")) and power is not None and float(power) > 0.0
        except Exception:
            include = False
        if include:
            result.append(component)
    return result

try:
    data = json.loads(Path(INPUT_PATH).read_text(encoding="utf-8"))
    for name in list(FreeCAD.listDocuments().keys()):
        if name == DOC_NAME:
            FreeCAD.closeDocument(name)
    doc = FreeCAD.newDocument(DOC_NAME)
    FreeCAD.setActiveDocument(doc.Name)
    objects = []
    envelope = build_envelope(doc, data)
    if envelope:
        objects.append(envelope)
    components = simulation_components(data)
    for component in components:
        placement = component.get("placement") if isinstance(component.get("placement"), dict) else {}
        objects.append(build_box(
            doc,
            str(component.get("id") or component.get("component_id")),
            placement.get("position") or component.get("position", [0,0,0]),
            component.get("dims", [1,1,1]),
            placement.get("rotation_matrix") or component.get("rotation_rows"),
        ))
    doc.recompute()
    Import.export(objects, str(STEP_PATH))
    try:
        FreeCADGui.ActiveDocument = FreeCADGui.getDocument(doc.Name)
        FreeCADGui.ActiveDocument.activeView().fitAll()
    except Exception:
        pass
    print(json.dumps({"success": True, "document": doc.Name, "save_path": str(STEP_PATH), "component_count": len(components), "wall_count": len(data.get("walls") or []), "wall_solid_count": 0, "envelope": bool(envelope), "export_object_count": len(objects)}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
'''


def render_script(input_path: Path, step_path: Path, doc_name: str) -> str:
    return (
        FREECAD_SCRIPT
        .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
        .replace("__DOC_NAME__", json.dumps(doc_name))
        .replace("__STEP_PATH__", json.dumps(str(step_path.resolve())))
    )


def main() -> int:
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).expanduser().resolve()
    spec_path = Path(args.spec).expanduser().resolve() if args.spec else default_spec_path(workspace_dir)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else default_cad_dir(workspace_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    spec = load_spec(spec_path)
    step_path = output_dir / "geometry_after_power_filtered.step"
    simulation_input_path = output_dir / "simulation_input.json"
    write_json(simulation_input_path, build_simulation_input(spec, step_filename=step_path.name))
    doc_name = args.doc_name or default_doc_name(workspace_dir, "simulation")
    host, port = freecad_rpc_settings(args.host, args.port)
    payload = execute_freecad_code(host, port, render_script(spec_path, step_path, doc_name))
    result = {
        "success": bool(payload.get("success")) and step_path.exists() and simulation_input_path.exists(),
        "spec_path": str(spec_path),
        "document": payload.get("document"),
        "step_path": str(step_path) if step_path.exists() else None,
        "simulation_input_path": str(simulation_input_path),
        "component_count": payload.get("component_count"),
        "wall_count": payload.get("wall_count"),
        "wall_solid_count": payload.get("wall_solid_count"),
        "envelope": payload.get("envelope"),
        "export_object_count": payload.get("export_object_count"),
        "freecad": payload,
    }
    print_result(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

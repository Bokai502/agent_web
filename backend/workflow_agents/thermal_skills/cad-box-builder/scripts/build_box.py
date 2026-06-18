#!/usr/bin/env python3
"""Build placeholder box geometry_after.glb from cad_build_spec.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from spec_common import default_cad_dir, default_doc_name, default_spec_path, execute_freecad_code, freecad_rpc_settings, load_spec, print_result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build box GLB from cad_build_spec.json.")
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
import ImportGui
import Part

INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
GLB_PATH = __GLB_PATH__
SCREENSHOT_DIR = __SCREENSHOT_DIR__

def matrix_to_rotation(rows):
    matrix = FreeCAD.Matrix()
    matrix.A11, matrix.A12, matrix.A13, matrix.A14 = float(rows[0][0]), float(rows[0][1]), float(rows[0][2]), 0
    matrix.A21, matrix.A22, matrix.A23, matrix.A24 = float(rows[1][0]), float(rows[1][1]), float(rows[1][2]), 0
    matrix.A31, matrix.A32, matrix.A33, matrix.A34 = float(rows[2][0]), float(rows[2][1]), float(rows[2][2]), 0
    matrix.A41, matrix.A42, matrix.A43, matrix.A44 = 0, 0, 0, 1
    return FreeCAD.Placement(matrix).Rotation

def build_envelope(doc, spec):
    envelope = spec.get("envelope") or {}
    outer_bbox = envelope.get("outer_bbox") or {}
    inner_bbox = envelope.get("inner_bbox") or {}
    outer_min, outer_max = outer_bbox.get("min"), outer_bbox.get("max")
    inner_min, inner_max = inner_bbox.get("min"), inner_bbox.get("max")
    if not outer_min or not outer_max or not inner_min or not inner_max:
        return None
    outer_size = [float(outer_max[i]) - float(outer_min[i]) for i in range(3)]
    inner_size = [float(inner_max[i]) - float(inner_min[i]) for i in range(3)]
    outer_shape = Part.makeBox(*outer_size, FreeCAD.Vector(*[float(v) for v in outer_min]))
    inner_shape = Part.makeBox(*inner_size, FreeCAD.Vector(*[float(v) for v in inner_min]))
    obj = doc.addObject("Part::Feature", "EnvelopeShell")
    obj.Shape = outer_shape.cut(inner_shape)
    obj.ViewObject.DisplayMode = "Wireframe"
    apply_color(obj, (envelope.get("display") or {}).get("color"), transparency=70)
    return obj

def apply_color(obj, color, transparency=0):
    if not isinstance(color, list) or len(color) < 3:
        return
    rgba = [max(0.0, min(1.0, float(value) / 255.0)) for value in color[:4]]
    while len(rgba) < 4:
        rgba.append(1.0)
    obj.ViewObject.ShapeColor = (rgba[0], rgba[1], rgba[2], rgba[3])
    if len(color) >= 4:
        obj.ViewObject.Transparency = int(max(0, min(100, round((1.0 - rgba[3]) * 100))))
    else:
        obj.ViewObject.Transparency = int(transparency)

def build_box(doc, name, position, dims, rotation_rows, color=None):
    obj = doc.addObject("Part::Box", name)
    obj.Length, obj.Width, obj.Height = [float(v) for v in dims]
    placement = FreeCAD.Placement()
    placement.Base = FreeCAD.Vector(*[float(v) for v in position])
    placement.Rotation = matrix_to_rotation(rotation_rows or [[1,0,0],[0,1,0],[0,0,1]])
    obj.Placement = placement
    apply_color(obj, color)
    return obj

def capture_screenshots(doc):
    screenshot_dir = Path(SCREENSHOT_DIR)
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    try:
        FreeCADGui.ActiveDocument = FreeCADGui.getDocument(doc.Name)
        view = FreeCADGui.ActiveDocument.activeView()
    except Exception as exc:
        return {"ok": False, "error": str(exc), "files": []}

    views = [
        ("front", "viewFront"),
        ("back", "viewRear"),
        ("left", "viewLeft"),
        ("right", "viewRight"),
        ("top", "viewTop"),
        ("bottom", "viewBottom"),
        ("isometric", "viewIsometric"),
    ]
    files = []
    for name, method_name in views:
        path = screenshot_dir / f"freecad_screenshot_{name}.png"
        try:
            method = getattr(view, method_name)
            method()
            view.fitAll()
            view.saveImage(str(path), 1600, 1200, "White")
            files.append(str(path))
        except Exception as exc:
            files.append({"path": str(path), "error": str(exc)})
    return {"ok": all(isinstance(item, str) for item in files), "files": files}

try:
    spec = json.loads(Path(INPUT_PATH).read_text(encoding="utf-8"))
    for name in list(FreeCAD.listDocuments().keys()):
        if name == DOC_NAME:
            FreeCAD.closeDocument(name)
    doc = FreeCAD.newDocument(DOC_NAME)
    FreeCAD.setActiveDocument(doc.Name)
    objects = []
    envelope = build_envelope(doc, spec)
    if envelope:
        objects.append(envelope)
    for wall in spec.get("walls", []):
        objects.append(build_box(doc, str(wall.get("id")), wall.get("position", [0,0,0]), wall.get("dims", [1,1,1]), [[1,0,0],[0,1,0],[0,0,1]], wall.get("color") or [217,166,64,255]))
    for component in spec.get("components", []):
        objects.append(build_box(doc, str(component.get("id")), component.get("position", [0,0,0]), component.get("dims", [1,1,1]), component.get("rotation_rows"), component.get("color")))
    doc.recompute()
    ImportGui.export(objects, str(GLB_PATH))
    try:
        FreeCADGui.ActiveDocument = FreeCADGui.getDocument(doc.Name)
        FreeCADGui.ActiveDocument.activeView().viewIsometric()
        FreeCADGui.ActiveDocument.activeView().fitAll()
    except Exception:
        pass
    screenshots = capture_screenshots(doc)
    print(json.dumps({"success": True, "document": doc.Name, "glb_path": str(GLB_PATH), "component_count": len(spec.get("components", [])), "wall_count": len(spec.get("walls", [])), "screenshots": screenshots}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
'''


def render_script(input_path: Path, glb_path: Path, screenshot_dir: Path, doc_name: str) -> str:
    return (
        FREECAD_SCRIPT
        .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
        .replace("__DOC_NAME__", json.dumps(doc_name))
        .replace("__GLB_PATH__", json.dumps(str(glb_path.resolve())))
        .replace("__SCREENSHOT_DIR__", json.dumps(str(screenshot_dir.resolve())))
    )


def main() -> int:
    args = parse_args()
    workspace_dir = Path(args.workspace_dir).expanduser().resolve()
    spec_path = Path(args.spec).expanduser().resolve() if args.spec else default_spec_path(workspace_dir)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else default_cad_dir(workspace_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    spec = load_spec(spec_path)
    glb_path = output_dir / "geometry_after.glb"
    screenshot_paths = [
        output_dir / f"freecad_screenshot_{name}.png"
        for name in ("front", "back", "left", "right", "top", "bottom", "isometric")
    ]
    doc_name = args.doc_name or default_doc_name(workspace_dir)
    host, port = freecad_rpc_settings(args.host, args.port)
    payload = execute_freecad_code(host, port, render_script(spec_path, glb_path, output_dir, doc_name))
    screenshot_status = payload.get("screenshots") if isinstance(payload.get("screenshots"), dict) else {}
    missing_screenshots = [str(path) for path in screenshot_paths if not path.exists() or path.stat().st_size <= 0]
    result = {
        "success": bool(payload.get("success")) and glb_path.exists() and not missing_screenshots,
        "spec_path": str(spec_path),
        "document": payload.get("document"),
        "glb_path": str(glb_path) if glb_path.exists() else None,
        "screenshots": {
            "ok": not missing_screenshots and bool(screenshot_status.get("ok", True)),
            "files": [str(path) for path in screenshot_paths if path.exists()],
            "missing": missing_screenshots,
            "freecad": screenshot_status,
        },
        "component_count": payload.get("component_count"),
        "wall_count": payload.get("wall_count"),
        "freecad": payload,
    }
    print_result(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

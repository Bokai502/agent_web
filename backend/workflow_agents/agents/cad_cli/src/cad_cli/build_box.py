#!/usr/bin/env python3
"""Build placeholder box geometry_after.glb from cad_build_spec.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .freecad_script_fragments import freecad_base_script
from .local_freecad_helpers import normalize_runtime_path
from .spec_common import add_common_build_args, default_doc_name, execute_freecad_code, freecad_rpc_settings, print_result, resolve_build_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build box GLB from cad_build_spec.json.")
    add_common_build_args(parser)
    return parser.parse_args()


FREECAD_SCRIPT = freecad_base_script(
    extra_imports="import ImportGui",
    constants=r'''
INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
GLB_PATH = __GLB_PATH__
SCREENSHOT_DIR = __SCREENSHOT_DIR__
''',
    helpers=r'''
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
''',
    body=r'''
try:
    spec = json.loads(Path(INPUT_PATH).read_text(encoding="utf-8"))
    doc = open_clean_document(DOC_NAME)
    objects = []
    envelope = build_envelope(doc, spec, wireframe=True)
    if envelope:
        objects.append(envelope)
    for wall in spec.get("walls", []):
        wall_obj = build_wall(doc, wall, wall.get("color") or [217,166,64,255])
        if wall_obj:
            objects.append(wall_obj)
    for component in spec.get("components", []):
        objects.append(build_box(doc, str(component.get("id")), component.get("position", [0,0,0]), component.get("dims", [1,1,1]), component.get("rotation_rows"), component.get("color")))
    doc.recompute()
    ImportGui.export(objects, str(GLB_PATH))
    fit_active_view(doc, isometric=True)
    screenshots = capture_screenshots(doc)
    print(json.dumps({"success": True, "document": doc.Name, "glb_path": str(GLB_PATH), "component_count": len(spec.get("components", [])), "wall_count": len(spec.get("walls", [])), "screenshots": screenshots}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)
''',
)


def render_script(input_path: Path, glb_path: Path, screenshot_dir: Path, doc_name: str) -> str:
    return (
        FREECAD_SCRIPT
        .replace("__FREECAD_MODULE_DIR__", json.dumps(normalize_runtime_path(Path(__file__).resolve().parent)))
        .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
        .replace("__DOC_NAME__", json.dumps(doc_name))
        .replace("__GLB_PATH__", json.dumps(str(glb_path.resolve())))
        .replace("__SCREENSHOT_DIR__", json.dumps(str(screenshot_dir.resolve())))
    )


def main() -> int:
    args = parse_args()
    workspace_dir, spec_path, output_dir, spec = resolve_build_paths(args)
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

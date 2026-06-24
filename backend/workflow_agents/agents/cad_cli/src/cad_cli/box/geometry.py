"""FreeCAD placeholder box geometry script support."""

from __future__ import annotations

import json
from pathlib import Path

from .screenshots import CadBoxScreenshotCapture
from .support import freecad_base_script, normalize_runtime_path


class CadBoxGeometryBuilder:
    """Render the FreeCAD script that builds placeholder box geometry."""

    constants = r'''
INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
GLB_PATH = __GLB_PATH__
SCREENSHOT_DIR = __SCREENSHOT_DIR__
'''

    body = r'''
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
'''

    def __init__(
        self,
        *,
        module_dir: Path | None = None,
        screenshot_capture: CadBoxScreenshotCapture | None = None,
    ) -> None:
        self.module_dir = module_dir or Path(__file__).resolve().parents[1]
        self.screenshot_capture = screenshot_capture or CadBoxScreenshotCapture()

    def render_script(
        self,
        input_path: Path,
        glb_path: Path,
        screenshot_dir: Path,
        doc_name: str,
    ) -> str:
        script = freecad_base_script(
            extra_imports="import ImportGui",
            constants=self.constants,
            helpers=self.screenshot_capture.helper_script,
            body=self.body,
        )
        return (
            script.replace(
                "__FREECAD_MODULE_DIR__",
                json.dumps(normalize_runtime_path(self.module_dir)),
            )
            .replace("__INPUT_PATH__", json.dumps(str(input_path.resolve())))
            .replace("__DOC_NAME__", json.dumps(doc_name))
            .replace("__GLB_PATH__", json.dumps(str(glb_path.resolve())))
            .replace("__SCREENSHOT_DIR__", json.dumps(str(screenshot_dir.resolve())))
        )

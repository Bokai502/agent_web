"""FreeCAD screenshot script support."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import SCREENSHOT_NAMES


class CadBoxScreenshotCapture:
    """Provide screenshot script code and validate screenshot artifacts."""

    helper_script = r'''
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
'''

    def paths(self, output_dir: Path) -> tuple[Path, ...]:
        return tuple(output_dir / f"freecad_screenshot_{name}.png" for name in SCREENSHOT_NAMES)

    def result(self, output_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
        screenshot_paths = self.paths(output_dir)
        screenshot_status = (
            payload.get("screenshots")
            if isinstance(payload.get("screenshots"), dict)
            else {}
        )
        missing_screenshots = [
            str(path)
            for path in screenshot_paths
            if not path.exists() or path.stat().st_size <= 0
        ]
        return {
            "ok": not missing_screenshots and bool(screenshot_status.get("ok", True)),
            "files": [str(path) for path in screenshot_paths if path.exists()],
            "missing": missing_screenshots,
            "freecad": screenshot_status,
        }

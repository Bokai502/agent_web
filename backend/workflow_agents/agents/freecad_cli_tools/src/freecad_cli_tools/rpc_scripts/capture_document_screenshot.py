import json
import sys
from pathlib import Path

import FreeCAD
import FreeCADGui

DOC_NAME = __DOC_NAME__
OUTPUT_PATH = __OUTPUT_PATH__
WIDTH = __WIDTH__
HEIGHT = __HEIGHT__
VIEW_NAME = __VIEW_NAME__


def find_document(doc_name):
    for name, doc in FreeCAD.listDocuments().items():
        if name == doc_name or getattr(doc, "Label", "") == doc_name:
            return doc
    return None


def apply_view(view, view_name):
    normalized = str(view_name or "Isometric").lower()
    try:
        view.setAnimationEnabled(False)
    except Exception:
        pass
    try:
        if normalized in {"top", "viewtop"}:
            view.viewTop()
        elif normalized in {"bottom", "viewbottom"}:
            view.viewBottom()
        elif normalized in {"front", "viewfront"}:
            view.viewFront()
        elif normalized in {"back", "rear", "viewback", "viewrear"}:
            view.viewRear()
        elif normalized in {"left", "viewleft"}:
            view.viewLeft()
        elif normalized in {"right", "viewright"}:
            view.viewRight()
        else:
            view.viewIsometric()
    except Exception:
        try:
            FreeCADGui.SendMsgToActiveView("ViewIsometric")
        except Exception:
            pass
    try:
        view.fitAll()
    except Exception:
        try:
            FreeCADGui.SendMsgToActiveView("ViewFit")
        except Exception:
            pass


try:
    doc = find_document(DOC_NAME)
    if doc is None:
        raise RuntimeError(f"FreeCAD document not found: {DOC_NAME}")
    FreeCAD.setActiveDocument(doc.Name)
    gui_doc = FreeCADGui.getDocument(doc.Name)
    if gui_doc is None:
        raise RuntimeError(f"FreeCAD GUI document not found: {doc.Name}")
    FreeCADGui.ActiveDocument = gui_doc
    view = gui_doc.activeView()
    apply_view(view, VIEW_NAME)
    output_path = Path(OUTPUT_PATH)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    view.saveImage(str(output_path), int(WIDTH), int(HEIGHT), "White")
    print(
        json.dumps(
            {
                "success": True,
                "document": doc.Name,
                "screenshot_path": str(output_path),
                "width": int(WIDTH),
                "height": int(HEIGHT),
                "view_name": VIEW_NAME,
            }
        )
    )
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)

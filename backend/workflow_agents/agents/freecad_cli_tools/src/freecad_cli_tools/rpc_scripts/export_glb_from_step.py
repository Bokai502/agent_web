import json
import sys

import FreeCAD
import FreeCADGui
import Import
import ImportGui

STEP_PATH = __STEP_PATH__
GLB_PATH = __GLB_PATH__
DOC_NAME = __DOC_NAME__
FIT_VIEW = __FIT_VIEW__


def set_view(doc_name):
    gui_doc = FreeCADGui.getDocument(doc_name)
    if gui_doc is None:
        return False
    FreeCADGui.ActiveDocument = gui_doc
    try:
        gui_doc.activeView().setAnimationEnabled(False)
    except Exception:
        pass
    try:
        gui_doc.activeView().viewIsometric()
    except Exception:
        try:
            FreeCADGui.SendMsgToActiveView("ViewIsometric")
        except Exception:
            pass
    try:
        gui_doc.activeView().fitAll()
    except Exception:
        try:
            FreeCADGui.SendMsgToActiveView("ViewFit")
        except Exception:
            pass
    return True


def export_glb(objects, glb_path):
    export_options = None
    if hasattr(ImportGui, "exportOptions"):
        try:
            export_options = ImportGui.exportOptions("glTF")
        except Exception:
            export_options = None

    if export_options is None:
        ImportGui.export(objects, glb_path)
    else:
        try:
            ImportGui.export(objects, glb_path, export_options)
        except TypeError:
            ImportGui.export(objects, glb_path)


try:
    for _name, _d in list(FreeCAD.listDocuments().items()):
        if _name == DOC_NAME or getattr(_d, "Label", "") == DOC_NAME:
            try:
                FreeCAD.closeDocument(_name)
            except Exception:
                pass

    doc = FreeCAD.newDocument(DOC_NAME)
    if doc.Label != DOC_NAME:
        doc.Label = DOC_NAME
    FreeCAD.setActiveDocument(doc.Name)

    Import.insert(STEP_PATH, doc.Name)
    doc.recompute()

    export_objects = [obj for obj in doc.Objects if not getattr(obj, "InList", [])]
    if not export_objects:
        export_objects = list(doc.Objects)
    if not export_objects:
        raise RuntimeError(f"STEP {STEP_PATH!r} produced no exportable objects.")

    export_glb(export_objects, GLB_PATH)
    view_updated = set_view(doc.Name) if FIT_VIEW else False

    print(
        json.dumps(
            {
                "success": True,
                "document": doc.Name,
                "step_path": STEP_PATH,
                "glb_path": GLB_PATH,
                "export_object_count": len(export_objects),
                "view_updated": view_updated,
            }
        )
    )
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)

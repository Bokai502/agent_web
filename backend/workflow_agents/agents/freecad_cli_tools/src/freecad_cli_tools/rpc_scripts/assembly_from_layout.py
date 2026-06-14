import json
import sys
from pathlib import Path

import FreeCAD
import FreeCADGui
import Import
import ImportGui
import Part

INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
SAVE_PATH = __SAVE_PATH__
EXPORT_GLB = __EXPORT_GLB__
FIT_VIEW = __FIT_VIEW__
VIEW_NAME = __VIEW_NAME__


def build_envelope(doc, assembly, data):
    envelope = data.get("envelope")
    if not envelope:
        return None

    outer_size = envelope.get("outer_size")
    inner_size = envelope.get("inner_size")
    shell_thickness = envelope.get("shell_thickness")
    if not outer_size or not inner_size or shell_thickness is None:
        return None

    outer_bbox = envelope.get("outer_bbox") or {}
    inner_bbox = envelope.get("inner_bbox") or {}
    outer_min = outer_bbox.get("min") or [-(float(v) / 2.0) for v in outer_size]
    inner_min = inner_bbox.get("min") or [-(float(v) / 2.0) for v in inner_size]

    outer_shape = Part.makeBox(
        float(outer_size[0]),
        float(outer_size[1]),
        float(outer_size[2]),
        FreeCAD.Vector(*outer_min),
    )
    inner_shape = Part.makeBox(
        float(inner_size[0]),
        float(inner_size[1]),
        float(inner_size[2]),
        FreeCAD.Vector(*inner_min),
    )
    shell_shape = outer_shape.cut(inner_shape)

    envelope_part = doc.addObject("App::Part", "Envelope_part")
    assembly.addObject(envelope_part)
    envelope_shell = doc.addObject("Part::Feature", "EnvelopeShell")
    envelope_shell.Shape = shell_shape
    envelope_shell.ViewObject.DisplayMode = "Wireframe"
    envelope_shell.ViewObject.LineColor = (0.2, 0.5, 0.9, 0.0)
    envelope_shell.ViewObject.LineWidth = 2.0
    envelope_part.addObject(envelope_shell)
    return envelope_shell.Name


__WALL_HELPERS__
__PLACEMENT_HELPERS__
__COMPONENT_SHAPE_HELPERS__


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


def apply_color(obj, color):
    if not color or len(color) < 3:
        return
    rgba = [float(c) / 255.0 for c in color[:4]]
    while len(rgba) < 4:
        rgba.append(1.0)
    obj.ViewObject.ShapeColor = (rgba[0], rgba[1], rgba[2], rgba[3])
    obj.ViewObject.Transparency = 40


def iter_descendant_shapes(container):
    stack = list(getattr(container, "Group", []) or [])
    while stack:
        obj = stack.pop()
        if obj is None:
            continue
        if obj.TypeId == "App::Part":
            stack.extend(getattr(obj, "Group", []) or [])
            continue
        try:
            shape = obj.Shape
        except Exception:
            continue
        if shape is None or shape.isNull():
            continue
        yield obj


def collect_glb_export_objects(objects):
    glb_objects = []
    for obj in objects:
        descendants = list(iter_descendant_shapes(obj))
        if descendants:
            glb_objects.extend(descendants)
            continue
        try:
            shape = obj.Shape
        except Exception:
            shape = None
        if shape is not None and not shape.isNull():
            glb_objects.append(obj)
    return glb_objects or list(objects)


def export_step_and_glb(objects, step_path):
    step_path = str(Path(step_path))
    glb_path = str(Path(step_path).with_suffix(".glb"))

    Import.export(objects, step_path)
    glb_objects = collect_glb_export_objects(objects)

    export_options = None
    if hasattr(ImportGui, "exportOptions"):
        try:
            export_options = ImportGui.exportOptions("glTF")
        except Exception:
            export_options = None

    if export_options is None:
        ImportGui.export(glb_objects, glb_path)
    else:
        try:
            ImportGui.export(glb_objects, glb_path, export_options)
        except TypeError:
            ImportGui.export(glb_objects, glb_path)

    return step_path, glb_path


def export_step(objects, step_path):
    step_path = str(Path(step_path))
    Import.export(objects, step_path)
    return step_path


try:
    path = Path(INPUT_PATH)
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

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

    try:
        assembly = doc.addObject("Assembly::AssemblyObject", "Assembly")
    except Exception:
        assembly = doc.addObject("App::Part", "Assembly")

    envelope_name = build_envelope(doc, assembly, data)
    wall_names = build_walls(doc, assembly, data)
    created = []
    components = list(data.get("components", {}).items())
    total_components = max(len(components), 1)
    for index, (component_id, component) in enumerate(components, start=1):
        part = doc.addObject("App::Part", f"{component_id}_part")
        assembly.addObject(part)

        shape_spec = build_component_shape_spec(component_id, component)
        solid = doc.addObject(shape_spec["object_type"], component_id)

        if shape_spec["shape"] == "box":
            solid.Length = shape_spec["length"]
            solid.Width = shape_spec["width"]
            solid.Height = shape_spec["height"]
        elif shape_spec["shape"] == "cylinder":
            solid.Radius = shape_spec["radius"]
            solid.Height = shape_spec["height"]
            solid.Angle = shape_spec["angle"]
        else:
            raise RuntimeError(f"Unsupported shape for {component_id}: {shape_spec['shape']}")

        solid.Placement = make_placement(
            shape_spec["placement_position"],
            shape_spec["rotation_rows"],
        )
        apply_color(solid, component.get("color"))
        part.addObject(solid)
        created.append(component_id)
    
    doc.recompute()
    if EXPORT_GLB:
        save_path, glb_path = export_step_and_glb([assembly], SAVE_PATH)
    else:
        save_path = export_step([assembly], SAVE_PATH)
        glb_path = None

    view_updated = False
    if FIT_VIEW:
        view_updated = set_view(doc.Name)

    print(
        json.dumps(
            {
                "success": True,
                "document": doc.Name,
                "save_path": save_path,
                "glb_path": glb_path,
                "component_count": len(created),
                "wall_count": len(wall_names),
                "envelope_object": envelope_name,
                "view_name": VIEW_NAME,
                "view_updated": view_updated,
            }
        )
    )
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)

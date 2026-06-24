"""Runtime helpers imported inside the FreeCAD RPC process for sim input builds."""

from __future__ import annotations

import FreeCAD
import FreeCADGui
import Part


def matrix_to_rotation(matrix_rows):
    matrix = FreeCAD.Matrix()
    matrix.A11 = float(matrix_rows[0][0])
    matrix.A12 = float(matrix_rows[0][1])
    matrix.A13 = float(matrix_rows[0][2])
    matrix.A14 = 0.0
    matrix.A21 = float(matrix_rows[1][0])
    matrix.A22 = float(matrix_rows[1][1])
    matrix.A23 = float(matrix_rows[1][2])
    matrix.A24 = 0.0
    matrix.A31 = float(matrix_rows[2][0])
    matrix.A32 = float(matrix_rows[2][1])
    matrix.A33 = float(matrix_rows[2][2])
    matrix.A34 = 0.0
    matrix.A41 = 0.0
    matrix.A42 = 0.0
    matrix.A43 = 0.0
    matrix.A44 = 1.0
    return FreeCAD.Placement(matrix).Rotation


def apply_color(obj, color, transparency=0, alpha_sets_transparency=True):
    if not isinstance(color, (list, tuple)) or len(color) < 3:
        return
    rgba = []
    for value in color[:4]:
        rgba.append(max(0.0, min(1.0, float(value) / 255.0)))
    while len(rgba) < 4:
        rgba.append(1.0)
    try:
        obj.ViewObject.ShapeColor = (rgba[0], rgba[1], rgba[2], rgba[3])
        if alpha_sets_transparency and len(color) >= 4:
            obj.ViewObject.Transparency = int(max(0, min(100, round((1.0 - rgba[3]) * 100))))
        else:
            obj.ViewObject.Transparency = int(transparency)
    except Exception:
        pass


def build_box(doc, name, position, dims, rotation_rows, color=None):
    obj = doc.addObject("Part::Box", name)
    obj.Length, obj.Width, obj.Height = [float(v) for v in dims]
    placement = FreeCAD.Placement()
    placement.Base = FreeCAD.Vector(*[float(v) for v in position])
    placement.Rotation = matrix_to_rotation(rotation_rows or [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    obj.Placement = placement
    apply_color(obj, color)
    return obj


def build_envelope(doc, data, wireframe=False):
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
    if wireframe:
        obj.ViewObject.DisplayMode = "Wireframe"
        apply_color(obj, (envelope.get("display") or {}).get("color"), transparency=70)
    return obj


def build_wall(doc, wall, color=None):
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
    return build_box(doc, wall_id, position, dims, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], color)


def open_clean_document(doc_name):
    for name in list(FreeCAD.listDocuments().keys()):
        if name == doc_name:
            FreeCAD.closeDocument(name)
    doc = FreeCAD.newDocument(doc_name)
    FreeCAD.setActiveDocument(doc.Name)
    return doc


def fit_active_view(doc, isometric=False):
    try:
        FreeCADGui.ActiveDocument = FreeCADGui.getDocument(doc.Name)
        view = FreeCADGui.ActiveDocument.activeView()
        if isometric:
            view.viewIsometric()
        view.fitAll()
    except Exception:
        pass

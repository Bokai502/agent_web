"""Runtime helpers imported inside the FreeCAD RPC process."""

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


def make_placement(position, rotation_rows):
    placement = FreeCAD.Placement()
    placement.Base = FreeCAD.Vector(float(position[0]), float(position[1]), float(position[2]))
    placement.Rotation = matrix_to_rotation(rotation_rows)
    return placement


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


def build_assembly_envelope(doc, assembly, data):
    envelope = data.get("envelope")
    if not envelope:
        return None
    outer_size = envelope.get("outer_size")
    inner_size = envelope.get("inner_size")
    shell_thickness = envelope.get("shell_thickness")
    if not outer_size or not inner_size or shell_thickness is None:
        return None

    outer_min = envelope.get("outer_min")
    inner_min = envelope.get("inner_min")
    if not outer_min or not inner_min:
        outer_min = [-(float(v) / 2.0) for v in outer_size]
        inner_min = [-(float(v) / 2.0) for v in inner_size]
    else:
        outer_min = [float(v) for v in outer_min]
        inner_min = [float(v) for v in inner_min]
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


def build_walls(doc, assembly, data):
    walls = data.get("walls") or []
    if not walls:
        return []

    walls_part = doc.addObject("App::Part", "Walls_part")
    assembly.addObject(walls_part)
    created = []
    for wall in walls:
        wall_id = str(wall.get("id") or wall.get("wall_id") or f"Wall_{len(created) + 1}")
        size = wall.get("size")
        position = wall.get("position")
        if not size or not position:
            bbox = wall.get("bbox") or {}
            bbox_min = bbox.get("min")
            bbox_max = bbox.get("max")
            if not bbox_min or not bbox_max:
                continue
            position = [float(value) for value in bbox_min]
            size = [float(bbox_max[axis]) - float(bbox_min[axis]) for axis in range(3)]
        if any(float(length) <= 0.0 for length in size):
            continue
        solid = doc.addObject("Part::Box", wall_id)
        solid.Length = float(size[0])
        solid.Width = float(size[1])
        solid.Height = float(size[2])
        solid.Placement = FreeCAD.Placement(FreeCAD.Vector(*position), FreeCAD.Rotation())
        solid.ViewObject.ShapeColor = (0.85, 0.65, 0.25, 0.0)
        solid.ViewObject.Transparency = 45
        walls_part.addObject(solid)
        created.append(wall_id)
    return created


def object_shape_or_none(obj):
    try:
        shape = obj.Shape
    except Exception:
        return None
    if shape is None or shape.isNull():
        return None
    return shape


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

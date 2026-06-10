import json
import sys
import time
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
TIMINGS = {
    "exports": {},
    "step_template_seconds": {},
    "build_seconds": {},
}

FACE_DEFINITIONS = {
    0: ("-x", 0, -1),
    1: ("x", 0, 1),
    2: ("-y", 1, -1),
    3: ("y", 1, 1),
    4: ("-z", 2, -1),
    5: ("z", 2, 1),
    6: ("ext-x", 0, -1),
    7: ("ext+x", 0, 1),
    8: ("ext-y", 1, -1),
    9: ("ext+y", 1, 1),
    10: ("ext-z", 2, -1),
    11: ("ext+z", 2, 1),
}
IDENTITY_ROTATION_ROWS = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
]


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


def determinant3(matrix_rows):
    return (
        matrix_rows[0][0] * (matrix_rows[1][1] * matrix_rows[2][2] - matrix_rows[1][2] * matrix_rows[2][1])
        - matrix_rows[0][1] * (matrix_rows[1][0] * matrix_rows[2][2] - matrix_rows[1][2] * matrix_rows[2][0])
        + matrix_rows[0][2] * (matrix_rows[1][0] * matrix_rows[2][1] - matrix_rows[1][1] * matrix_rows[2][0])
    )


def signed_permutation_rotations():
    rotations = []
    import itertools

    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1, 1), repeat=3):
            matrix_rows = [[0.0, 0.0, 0.0] for _ in range(3)]
            for row, col in enumerate(perm):
                matrix_rows[row][col] = float(signs[row])
            if determinant3(matrix_rows) == 1:
                rotations.append(matrix_rows)
    return rotations


ROTATION_ROWS = signed_permutation_rotations()


def face_normal(face_id):
    _, axis, direction = FACE_DEFINITIONS[int(face_id)]
    normal = [0.0, 0.0, 0.0]
    normal[axis] = float(direction)
    return normal


def apply_rotation_rows(rotation_rows, point):
    return [
        sum(float(rotation_rows[row][col]) * float(point[col]) for col in range(3))
        for row in range(3)
    ]


def multiply_rotation_rows(left_rows, right_rows):
    return [
        [
            sum(float(left_rows[row][k]) * float(right_rows[k][col]) for k in range(3))
            for col in range(3)
        ]
        for row in range(3)
    ]


def installation_contact_world_face(install_face):
    install_face = int(install_face)
    if install_face >= 6:
        return (install_face - 6) ^ 1
    return install_face


def choose_rotation_rows(component_face, target_envelope_face):
    source = face_normal(component_face)
    target = face_normal(installation_contact_world_face(target_envelope_face))
    candidates = [
        matrix_rows
        for matrix_rows in ROTATION_ROWS
        if apply_rotation_rows(matrix_rows, source) == target
    ]
    if not candidates:
        raise RuntimeError("No valid orthogonal rotation found for requested face change.")
    candidates.sort(key=lambda rows: sum(rows[i][i] for i in range(3)), reverse=True)
    return candidates[0]


def rotation_about_axis(axis_index, quarter_turns):
    turns = int(quarter_turns) % 4
    if turns == 0:
        return [row[:] for row in IDENTITY_ROTATION_ROWS]
    if axis_index == 0:
        step = [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]]
    elif axis_index == 1:
        step = [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]]
    elif axis_index == 2:
        step = [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
    else:
        raise RuntimeError(f"Invalid rotation axis index {axis_index!r}")
    result = [row[:] for row in IDENTITY_ROTATION_ROWS]
    for _ in range(turns):
        result = multiply_rotation_rows(step, result)
    return result


def normalize_spin_quarter_turns(angle_degrees):
    quarter_turns = float(angle_degrees) / 90.0
    rounded = round(quarter_turns)
    if abs(quarter_turns - rounded) > 1e-9:
        raise RuntimeError("Spin angle must be a multiple of 90 degrees.")
    return int(rounded) % 4


def apply_in_plane_spin_rows(base_rotation, target_envelope_face, spin_quarter_turns):
    _, axis_index, direction = FACE_DEFINITIONS[int(target_envelope_face)]
    signed_turns = spin_quarter_turns if direction > 0 else -spin_quarter_turns
    return multiply_rotation_rows(
        rotation_about_axis(axis_index, signed_turns),
        base_rotation,
    )


def orientation_rows_from_normalized_placement(placement):
    install_face = int(placement.get("install_face"))
    component_face = int(placement.get("component_local_face"))
    orientation_rows = choose_rotation_rows(component_face, install_face)
    alignment = placement.get("alignment") or {}
    spin_degrees = float(alignment.get("in_plane_rotation_deg", 0.0) or 0.0)
    if abs(spin_degrees) > 1e-9:
        orientation_rows = apply_in_plane_spin_rows(
            orientation_rows,
            install_face,
            normalize_spin_quarter_turns(spin_degrees),
        )
    return orientation_rows


def build_envelope(doc, assembly, data):
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


def apply_color(obj, color, transparency=0):
    if not color or len(color) < 3:
        return
    rgba = [float(c) / 255.0 for c in color[:4]]
    while len(rgba) < 4:
        rgba.append(1.0)
    try:
        obj.ViewObject.ShapeColor = (rgba[0], rgba[1], rgba[2], rgba[3])
        obj.ViewObject.Transparency = int(transparency)
    except Exception:
        pass


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


def collect_shape_objects(objects):
    shape_objects = []
    for obj in objects:
        descendants = list(iter_descendant_shapes(obj))
        if descendants:
            shape_objects.extend(descendants)
            continue
        try:
            shape = obj.Shape
        except Exception:
            shape = None
        if shape is not None and not shape.isNull():
            shape_objects.append(obj)
    return shape_objects


def collect_glb_export_objects(objects):
    glb_objects = collect_shape_objects(objects)
    return glb_objects or list(objects)


def export_step_and_glb(objects, step_path):
    step_path = str(Path(step_path))
    glb_path = str(Path(step_path).with_suffix(".glb"))
    step_started = time.monotonic()
    Import.export(objects, step_path)
    TIMINGS["exports"]["step_export_seconds"] = time.monotonic() - step_started
    glb_objects = collect_glb_export_objects(objects)
    export_options = None
    if hasattr(ImportGui, "exportOptions"):
        try:
            export_options = ImportGui.exportOptions("glTF")
        except Exception:
            export_options = None
    if export_options is None:
        glb_started = time.monotonic()
        ImportGui.export(glb_objects, glb_path)
    else:
        try:
            glb_started = time.monotonic()
            ImportGui.export(glb_objects, glb_path, export_options)
        except TypeError:
            glb_started = time.monotonic()
            ImportGui.export(glb_objects, glb_path)
    TIMINGS["exports"]["glb_export_seconds"] = time.monotonic() - glb_started
    return step_path, glb_path


def export_step(objects, step_path):
    step_path = str(Path(step_path))
    Import.export(objects, step_path)
    return step_path


def create_component_part(doc, component_id):
    return doc.addObject("App::Part", f"{component_id}_part")


def shape_world_bbox(obj):
    try:
        shape = obj.Shape
    except Exception:
        return None
    if shape is None or shape.isNull():
        return None
    placed = shape.copy()
    placed.Placement = obj.getGlobalPlacement()
    bb = placed.BoundBox
    if not bb.isValid():
        return None
    return bb


def aggregate_world_bbox(objs):
    aggregate = None
    for obj in objs:
        bb = shape_world_bbox(obj)
        if bb is None:
            continue
        if aggregate is None:
            aggregate = FreeCAD.BoundBox(bb)
        else:
            aggregate.add(bb)
    return aggregate


def bbox_edge(bb, axis, use_max):
    if axis == 0:
        return bb.XMax if use_max else bb.XMin
    if axis == 1:
        return bb.YMax if use_max else bb.YMin
    return bb.ZMax if use_max else bb.ZMin


def bbox_center_from_bounds(bb):
    return [
        (bb.XMin + bb.XMax) / 2.0,
        (bb.YMin + bb.YMax) / 2.0,
        (bb.ZMin + bb.ZMax) / 2.0,
    ]


def copy_global_shape(obj):
    try:
        shape = obj.Shape
    except Exception:
        return None
    if shape is None or shape.isNull():
        return None
    placed = shape.copy()
    placed.Placement = obj.getGlobalPlacement()
    return placed


def build_shape_template(shape_objects):
    shapes = []
    for obj in shape_objects:
        placed = copy_global_shape(obj)
        if placed is None:
            continue
        shapes.append(placed)
    if not shapes:
        return None
    if len(shapes) == 1:
        return shapes[0]
    return Part.makeCompound(shapes)


def transformed_shape_and_bbox(shape, rotation_rows):
    transformed = shape.copy()
    transformed.Placement = FreeCAD.Placement(
        FreeCAD.Vector(0.0, 0.0, 0.0),
        matrix_to_rotation(rotation_rows),
    )
    bb = transformed.BoundBox
    if bb is None or not bb.isValid():
        return transformed, None
    return transformed, bb


def component_target_bbox(component):
    bbox = component.get("target_bbox") or {}
    minimum = bbox.get("min")
    maximum = bbox.get("max")
    if not isinstance(minimum, list) or not isinstance(maximum, list):
        raise RuntimeError(f"Component {component.get('id')!r} is missing target_bbox min/max.")
    return {
        "min": [float(value) for value in minimum],
        "max": [float(value) for value in maximum],
    }


def create_box_component(doc, part, component_id, component, target_bbox):
    minimum = target_bbox["min"]
    maximum = target_bbox["max"]
    size = [maximum[index] - minimum[index] for index in range(3)]
    solid = doc.addObject("Part::Box", component_id)
    solid.Length = float(size[0])
    solid.Width = float(size[1])
    solid.Height = float(size[2])
    solid.Placement.Base = FreeCAD.Vector(*minimum)
    apply_color(solid, component.get("color"), transparency=40)
    part.addObject(solid)
    return {"mode": "box", "object_names": [solid.Name], "fallback": True}


def cleanup_imported_objects(doc, imported_objects):
    for obj in reversed(imported_objects):
        try:
            doc.removeObject(obj.Name)
        except Exception:
            pass


def close_document_quietly(doc_name):
    try:
        FreeCAD.closeDocument(doc_name)
    except Exception:
        pass


def build_step_template(step_path):
    temp_doc_name = f"StepTemplate_{abs(hash(step_path))}"
    for existing_name, existing_doc in list(FreeCAD.listDocuments().items()):
        if existing_name == temp_doc_name or getattr(existing_doc, "Label", "") == temp_doc_name:
            close_document_quietly(existing_name)

    temp_doc = FreeCAD.newDocument(temp_doc_name)
    if temp_doc.Label != temp_doc_name:
        temp_doc.Label = temp_doc_name
    started = time.monotonic()
    try:
        before = {o.Name for o in temp_doc.Objects}
        Import.insert(step_path, temp_doc.Name)
        temp_doc.recompute()
        new_objs = [o for o in temp_doc.Objects if o.Name not in before]
        if not new_objs:
            return None

        top_level_new = [o for o in new_objs if not getattr(o, "InList", [])]
        template_roots = top_level_new or new_objs
        shape_objects = collect_shape_objects(template_roots)
        if not shape_objects:
            shape_objects = collect_shape_objects(new_objs)
        if not shape_objects:
            return None
        template_bbox = aggregate_world_bbox(shape_objects)
        template_shape = build_shape_template(shape_objects)
        if template_bbox is None or template_shape is None or template_shape.isNull():
            return None
        return {
            "shape": template_shape,
            "bbox": template_bbox,
            "shape_object_count": len(shape_objects),
        }
    finally:
        TIMINGS["step_template_seconds"][step_path] = time.monotonic() - started
        close_document_quietly(temp_doc.Name)


def create_step_component(doc, part, component_id, component, target_bbox, step_template_cache):
    source = component.get("source") or {}
    step_path = source.get("step_path")
    if not step_path:
        return create_box_component(doc, part, component_id, component, target_bbox)

    placement = component.get("placement") or {}
    mount_axis = int(placement.get("mount_axis", 2))
    mount_direction = int(placement.get("mount_direction", 1))
    external = bool(placement.get("external"))
    flange_dir = [0.0, 0.0, 0.0]
    flange_dir[mount_axis] = (-mount_direction) if external else mount_direction

    template = step_template_cache.get(step_path)
    cache_hit = template is not None
    if template is None:
        template = build_step_template(step_path)
        if template is not None:
            step_template_cache[step_path] = template
    if template is None:
        return create_box_component(doc, part, component_id, component, target_bbox)

    rotation_rows = orientation_rows_from_normalized_placement(placement)
    rotated_shape, rb = transformed_shape_and_bbox(template["shape"], rotation_rows)
    if rb is None:
        return create_box_component(doc, part, component_id, component, target_bbox)
    rb_center = bbox_center_from_bounds(rb)
    target_center = [
        (target_bbox["min"][axis] + target_bbox["max"][axis]) / 2.0 for axis in range(3)
    ]
    delta = [0.0, 0.0, 0.0]
    for axis in range(3):
        if axis == mount_axis:
            target_contact = (
                target_bbox["max"][axis] if flange_dir[axis] > 0.0 else target_bbox["min"][axis]
            )
            current_contact = bbox_edge(rb, axis, flange_dir[axis] > 0.0)
            delta[axis] = target_contact - current_contact
        else:
            delta[axis] = target_center[axis] - rb_center[axis]

    solid = doc.addObject("Part::Feature", component_id)
    instance_shape = rotated_shape.copy()
    instance_shape.translate(FreeCAD.Vector(*delta))
    solid.Shape = instance_shape
    apply_color(solid, component.get("color"), transparency=0)
    part.addObject(solid)

    return {
        "mode": "step",
        "object_names": [solid.Name],
        "fallback": False,
        "translation": delta,
        "rotation_rows": rotation_rows,
        "step_path": step_path,
        "cache_hit": cache_hit,
        "shape_object_count": int(template.get("shape_object_count", 1)),
    }


try:
    build_started = time.monotonic()
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

    # This workflow builds a static export assembly, not a kinematic one.
    # Using App::Part avoids triggering the Assembly workbench solver (MbD),
    # which can stall execute_code for large imported STEP payloads.
    assembly = doc.addObject("App::Part", "Assembly")

    envelope_name = build_envelope(doc, assembly, data)
    created = []
    step_component_ids = []
    box_component_ids = []
    fallback_box_component_ids = []
    fallback_components_by_reason = {}
    step_template_cache = {}

    components = list(data.get("components", {}).items())
    total_components = max(len(components), 1)
    for index, (component_id, component) in enumerate(components, start=1):
        component_started = time.monotonic()
        target_bbox = component_target_bbox(component)
        source = component.get("source") or {}
        fallback_reason = source.get("fallback_reason")
        part = create_component_part(doc, component_id)
        assembly.addObject(part)
        build_result = create_step_component(
            doc,
            part,
            component_id,
            component,
            target_bbox,
            step_template_cache,
        )
        created.append(
            {
                "component_id": component_id,
                "mode": build_result["mode"],
                "category": component.get("category"),
                "source_step_path": source.get("step_path"),
                "requested_step_path": source.get("requested_step_path"),
                "step_size_bytes": source.get("step_size_bytes"),
                "fallback_reason": fallback_reason,
                "fallback_box": bool(build_result.get("fallback")),
                "cache_hit": build_result.get("cache_hit"),
                "shape_object_count": build_result.get("shape_object_count"),
                "target_bbox": target_bbox,
            }
        )
        if build_result["mode"] == "step":
            step_component_ids.append(component_id)
        else:
            box_component_ids.append(component_id)
        if build_result.get("fallback"):
            fallback_box_component_ids.append(component_id)
            if fallback_reason:
                fallback_components_by_reason.setdefault(fallback_reason, []).append(component_id)
        TIMINGS["build_seconds"][component_id] = time.monotonic() - component_started
    
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
                "components": created,
                "step_component_ids": step_component_ids,
                "box_component_ids": box_component_ids,
                "fallback_box_component_ids": fallback_box_component_ids,
                "fallback_components_by_reason": fallback_components_by_reason,
                "timings": {
                    **TIMINGS,
                    "total_build_seconds": time.monotonic() - build_started,
                },
                "envelope_object": envelope_name,
                "view_name": VIEW_NAME,
                "view_updated": view_updated,
            }
        )
    )
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)

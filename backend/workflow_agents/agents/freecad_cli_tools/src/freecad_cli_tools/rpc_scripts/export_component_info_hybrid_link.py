import json
import math
import re
import struct
import sys
import time
from pathlib import Path

import FreeCAD
import Import
import Part
import MeshPart

INPUT_PATH = __INPUT_PATH__
DOC_NAME = __DOC_NAME__
SAVE_PATH = __SAVE_PATH__
EXPORT_GLB = __EXPORT_GLB__
INCLUDE_ENVELOPE = __INCLUDE_ENVELOPE__

OUT_STEP = SAVE_PATH
OUT_GLB = str(Path(SAVE_PATH).with_suffix(".glb")) if EXPORT_GLB else None
SUMMARY = str(Path(SAVE_PATH).with_suffix(".hybrid_summary.json"))
NORMALIZED_INPUT = INPUT_PATH
MAPPING = {}

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
    return multiply_rotation_rows(rotation_about_axis(axis_index, signed_turns), base_rotation)


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


def normalized_id(value):
    value = str(value or "")
    if value.endswith("_part"):
        value = value[:-5]
    return re.sub(r"[^0-9A-Za-z]+", "_", value).strip("_").upper()


def base_id(name):
    return name[:-5] if name.endswith("_part") else name


def mapping_info_for_name(name):
    return MAPPING.get(base_id(name)) or MAPPING.get(normalized_id(base_id(name))) or {}


def object_ids(obj):
    values = set()
    for attr in ("Name", "Label"):
        try:
            values.add(normalized_id(base_id(getattr(obj, attr))))
        except Exception:
            pass
    return values


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
        if placed is not None:
            shapes.append(placed)
    if not shapes:
        return None
    if len(shapes) == 1:
        return shapes[0]
    return Part.makeCompound(shapes)


def transformed_shape_and_bbox(shape, rotation_rows):
    transformed = shape.copy()
    matrix = FreeCAD.Matrix()
    matrix.A11 = float(rotation_rows[0][0])
    matrix.A12 = float(rotation_rows[0][1])
    matrix.A13 = float(rotation_rows[0][2])
    matrix.A14 = 0.0
    matrix.A21 = float(rotation_rows[1][0])
    matrix.A22 = float(rotation_rows[1][1])
    matrix.A23 = float(rotation_rows[1][2])
    matrix.A24 = 0.0
    matrix.A31 = float(rotation_rows[2][0])
    matrix.A32 = float(rotation_rows[2][1])
    matrix.A33 = float(rotation_rows[2][2])
    matrix.A34 = 0.0
    matrix.A41 = 0.0
    matrix.A42 = 0.0
    matrix.A43 = 0.0
    matrix.A44 = 1.0
    transformed.transformShape(matrix, True)
    bb = transformed.BoundBox
    if bb is None or not bb.isValid():
        return transformed, None
    return transformed, bb


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


def bbox_payload(bb):
    return {
        "min": [bb.XMin, bb.YMin, bb.ZMin],
        "max": [bb.XMax, bb.YMax, bb.ZMax],
    }


def component_target_bbox(component):
    bbox = component.get("target_bbox") or {}
    return {
        "min": [float(value) for value in bbox["min"]],
        "max": [float(value) for value in bbox["max"]],
    }


def import_step_template(doc, step_path, group_index, rotation_rows):
    before = {obj.Name for obj in doc.Objects}
    Import.insert(step_path, doc.Name)
    doc.recompute()
    new_objects = [obj for obj in doc.Objects if obj.Name not in before]
    top_level = [obj for obj in new_objects if not getattr(obj, "InList", [])]
    roots = top_level or new_objects
    shape_objects = collect_shape_objects(roots)
    if not shape_objects:
        shape_objects = collect_shape_objects(new_objects)
    if not shape_objects:
        return None

    template_shape = build_shape_template(shape_objects)
    if template_shape is None or template_shape.isNull():
        return None
    rotated_template_shape, rotated_template_bbox = transformed_shape_and_bbox(template_shape, rotation_rows)
    if rotated_template_bbox is None:
        return None

    template_object = doc.addObject("Part::Feature", f"LinkedSTEPTemplate_{group_index:03d}")
    template_object.Shape = rotated_template_shape.copy()
    try:
        template_object.Label = f"LinkedSTEPTemplate__{group_index:03d}__{Path(step_path).name}"
        template_object.Visibility = False
    except Exception:
        pass
    for obj in reversed(new_objects):
        if obj.Name == template_object.Name:
            continue
        try:
            doc.removeObject(obj.Name)
        except Exception:
            pass
    return template_object, rotated_template_bbox, len(shape_objects)


def target_center(target_bbox):
    return [
        (target_bbox["min"][axis] + target_bbox["max"][axis]) / 2.0
        for axis in range(3)
    ]


def create_link_for_component(doc, linked_root, template_object, template_bbox, component_id, component):
    placement = component.get("placement") or {}
    target_bbox = component_target_bbox(component)
    mount_axis = int(placement.get("mount_axis", 2))
    mount_direction = int(placement.get("mount_direction", 1))
    external = bool(placement.get("external"))
    flange_dir = [0.0, 0.0, 0.0]
    flange_dir[mount_axis] = (-mount_direction) if external else mount_direction

    rb_center = bbox_center_from_bounds(template_bbox)
    center = target_center(target_bbox)
    delta = [0.0, 0.0, 0.0]
    for axis in range(3):
        if axis == mount_axis:
            target_contact = target_bbox["max"][axis] if flange_dir[axis] > 0.0 else target_bbox["min"][axis]
            current_contact = bbox_edge(template_bbox, axis, flange_dir[axis] > 0.0)
            delta[axis] = target_contact - current_contact
        else:
            delta[axis] = center[axis] - rb_center[axis]

    link = doc.addObject("App::Link", component_id)
    link.LinkedObject = template_object
    link.Label = component_id
    try:
        link.addProperty("App::PropertyString", "ComponentID", "Traceability", "Stable pipeline component id")
    except Exception:
        pass
    try:
        link.ComponentID = component_id
    except Exception:
        pass
    # STEP export has proven unreliable for per-link rotations. The template is
    # already pre-rotated for this orientation group, so links only translate.
    link.Placement = FreeCAD.Placement(FreeCAD.Vector(*delta), FreeCAD.Rotation())
    linked_root.addObject(link)
    doc.recompute()
    actual_bbox = None
    try:
        actual_bbox = bbox_payload(link.Shape.BoundBox)
    except Exception:
        actual_bbox = bbox_payload(template_bbox)
    return {
        "component_id": component_id,
        "translation": delta,
        "target_bbox": target_bbox,
        "actual_bbox": actual_bbox,
    }


def placement_with_component_local_face(component, component_local_face):
    patched = json.loads(json.dumps(component))
    placement = patched.setdefault("placement", {})
    placement["component_local_face"] = int(component_local_face)
    component_id = str(patched.get("component_id") or patched.get("id") or "")
    suffix = FACE_DEFINITIONS[int(component_local_face)][0]
    suffix = suffix.replace("-", "min").replace("x", "x").replace("y", "y").replace("z", "z")
    if suffix.startswith("min"):
        axis = FACE_DEFINITIONS[int(component_local_face)][0][-1]
        local_suffix = f"{axis}min"
    else:
        local_suffix = f"{suffix}max" if len(suffix) == 1 else suffix
    if component_id:
        placement["component_mount_face_id"] = f"{component_id}.local_{local_suffix}"
    return patched


def canonical_component_local_face(items):
    """Use one CAD-local mount face for every instance of a shared STEP file.

    Repeated STEP groups represent one physical CAD model. Per-slot local
    faces from the original template are not valid for a shared replacement
    asset because they describe already-oriented template instances. The first
    slot is the stable reference for the shared CAD's local contact face.
    """

    for _component_id, component in items:
        placement = component.get("placement") or {}
        if placement.get("component_local_face") is not None:
            return int(placement["component_local_face"])
    return 4


def remove_previous_linked_export_objects(doc):
    for obj in reversed(list(doc.Objects)):
        label = ""
        try:
            label = str(getattr(obj, "Label", "") or "")
        except Exception:
            pass
        name = ""
        try:
            name = str(getattr(obj, "Name", "") or "")
        except Exception:
            pass
        if (
            label.startswith("LinkedSTEPGroup__")
            or label.startswith("LinkedSTEPTemplate__")
            or name.startswith("HybridLinkTemplate_")
            or name.startswith("LinkedSTEPGroup_")
            or name.startswith("LinkedSTEPTemplate_")
        ):
            try:
                doc.removeObject(obj.Name)
            except Exception:
                pass


def repeated_step_groups(data):
    groups = {}
    for component_id, component in (data.get("components") or {}).items():
        source = component.get("source") or {}
        step_path = source.get("step_path")
        if not step_path or not Path(step_path).exists():
            continue
        groups.setdefault(str(Path(step_path)), []).append((component_id, component))
    return {path: items for path, items in groups.items() if len(items) > 1}


def label_original_component(obj):
    info = mapping_info_for_name(obj.Name)
    original = info.get("template_component_id") or base_id(obj.Name)
    selected = info.get("selected_component_id")
    action = info.get("action")
    if selected and action == "replace":
        label = f"{original}__REPLACED_BY__{selected}"
        renamed = {"component_id": original, "freecad_name": obj.Name, "label": label, "selected_component_id": selected}
    else:
        label = f"{original}__TEMPLATE_KEEP"
        renamed = None
    try:
        obj.Label = label
    except Exception:
        pass
    for child in list(getattr(obj, "Group", []) or []):
        try:
            child.Label = label
        except Exception:
            pass
    return renamed


def collect_glb_export_objects(objects):
    glb_objects = collect_shape_objects(objects)
    return glb_objects or list(objects)


COMPONENT_GLB_LINEAR_DEFLECTION = 12.0
COMPONENT_GLB_ANGULAR_DEFLECTION = 0.75
COMPONENT_GLB_MAX_VERTICES = 25000


def _align4(value):
    return (int(value) + 3) & ~3


def _pack_f32(values):
    pack = struct.Struct("<f").pack
    out = bytearray()
    for value in values:
        out += pack(float(value))
    return bytes(out)


def _pack_u16(values):
    pack = struct.Struct("<H").pack
    out = bytearray()
    for value in values:
        out += pack(int(value))
    return bytes(out)


def _mesh_normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / length, ny / length, nz / length)


def _minmax_vec3(values):
    if not values:
        return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
    return [min(v[i] for v in values) for i in range(3)], [max(v[i] for v in values) for i in range(3)]


def _freecad_point_to_gltf(point):
    # Match the legacy FreeCAD/OCC GLB export used by the web viewer:
    # FreeCAD mm, Z-up -> glTF meters, Y-up.
    return (float(point[0]) / 1000.0, float(point[2]) / 1000.0, -float(point[1]) / 1000.0)


def _freecad_normal_to_gltf(normal):
    return (float(normal[0]), float(normal[2]), -float(normal[1]))


def _shape_copy_for_mesh(obj):
    try:
        shape = obj.Shape
    except Exception:
        return None
    if shape is None or shape.isNull():
        return None
    copied = shape.copy()
    try:
        copied.Placement = obj.getGlobalPlacement()
    except Exception:
        pass
    return copied


def _mesh_shape_to_chunks(shape, max_vertices=COMPONENT_GLB_MAX_VERTICES):
    mesh = MeshPart.meshFromShape(
        Shape=shape,
        LinearDeflection=COMPONENT_GLB_LINEAR_DEFLECTION,
        AngularDeflection=COMPONENT_GLB_ANGULAR_DEFLECTION,
        Relative=False,
    )
    points, facets = mesh.Topology
    points = [(float(p.x), float(p.y), float(p.z)) for p in points]
    facets = [tuple(int(i) for i in f) for f in facets]
    chunks = []
    remap = {}
    vertices = []
    normals_acc = []
    indices = []

    def flush():
        nonlocal remap, vertices, normals_acc, indices
        if not vertices or not indices:
            remap = {}
            vertices = []
            normals_acc = []
            indices = []
            return
        normals = []
        for nx, ny, nz in normals_acc:
            length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            normals.append((nx / length, ny / length, nz / length))
        chunks.append((vertices, normals, indices))
        remap = {}
        vertices = []
        normals_acc = []
        indices = []

    def add_vertex(old_idx, normal):
        nonlocal remap, vertices, normals_acc
        new_idx = remap.get(old_idx)
        if new_idx is None:
            new_idx = len(vertices)
            remap[old_idx] = new_idx
            vertices.append(points[old_idx])
            normals_acc.append([0.0, 0.0, 0.0])
        normals_acc[new_idx][0] += normal[0]
        normals_acc[new_idx][1] += normal[1]
        normals_acc[new_idx][2] += normal[2]
        return new_idx

    for facet in facets:
        if len(remap) + 3 > max_vertices:
            flush()
        a, b, c = points[facet[0]], points[facet[1]], points[facet[2]]
        normal = _mesh_normal(a, b, c)
        indices.extend([
            add_vertex(facet[0], normal),
            add_vertex(facet[1], normal),
            add_vertex(facet[2], normal),
        ])
    flush()
    return chunks, len(points), len(facets)


def _rgba_from_object(obj, fallback=(0.65, 0.68, 0.70, 1.0)):
    try:
        color = obj.ViewObject.ShapeColor
        alpha = 1.0 - (float(getattr(obj.ViewObject, "Transparency", 0) or 0.0) / 100.0)
        return [float(color[0]), float(color[1]), float(color[2]), max(0.05, min(1.0, alpha))]
    except Exception:
        return list(fallback)


def _component_name_for_glb(obj):
    try:
        component_id = str(getattr(obj, "ComponentID", "") or "")
        if component_id.startswith("P") and len(component_id) >= 4 and component_id[1:4].isdigit():
            return component_id[:4]
    except Exception:
        pass
    label = str(getattr(obj, "Label", "") or "")
    name = str(getattr(obj, "Name", "") or "")
    for value in (label, name):
        if value == "Envelope_part" or value == "EnvelopeShell":
            return "EnvelopeShell"
        if value.startswith("P") and len(value) >= 4 and value[1:4].isdigit():
            return value[:4]
        if value.endswith("_part") and value.startswith("P") and value[1:4].isdigit():
            return value[:4]
        if "__" in value and value.startswith("P") and value[1:4].isdigit():
            return value[:4]
    return base_id(name) or label or name


def _collect_component_glb_shapes(export_parts):
    items = []
    for obj in export_parts:
        if obj is None:
            continue
        name = _component_name_for_glb(obj)
        if name.startswith("LinkedSTEPGroup_") or name.startswith("LinkedSTEPGroup__"):
            for child in list(getattr(obj, "Group", []) or []):
                shape = _shape_copy_for_mesh(child)
                if shape is not None:
                    items.append((_component_name_for_glb(child), child, shape))
            continue
        if obj.TypeId == "App::Part" and name not in ("EnvelopeShell", "Envelope_part"):
            shapes = []
            for child in list(iter_descendant_shapes(obj)):
                child_shape = _shape_copy_for_mesh(child)
                if child_shape is not None:
                    shapes.append(child_shape)
            if shapes:
                shape = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
                items.append((name, obj, shape))
                continue
        shape = _shape_copy_for_mesh(obj)
        if shape is not None:
            items.append((name, obj, shape))
    return items


def export_component_node_glb(export_parts, glb_path):
    started = time.monotonic()
    glb_path = Path(glb_path)
    items = _collect_component_glb_shapes(export_parts)
    binout = bytearray()
    buffer_views = []
    accessors = []
    materials = []
    material_by_rgba = {}
    meshes = []
    nodes = [{"name": "SceneRoot", "children": []}]
    component_summaries = []

    def material_index(obj, name):
        rgba = _rgba_from_object(obj)
        if name == "EnvelopeShell":
            rgba = [0.35, 0.55, 1.0, 0.20]
        key = tuple(round(float(v), 4) for v in rgba)
        if key not in material_by_rgba:
            material = {
                "name": f"mat_{len(materials)}",
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(key),
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.65,
                },
                "doubleSided": True,
            }
            if key[3] < 0.999:
                material["alphaMode"] = "BLEND"
            material_by_rgba[key] = len(materials)
            materials.append(material)
        return material_by_rgba[key]

    for name, obj, shape in items:
        try:
            chunks, mesh_points, mesh_triangles = _mesh_shape_to_chunks(shape)
        except Exception as exc:
            component_summaries.append({"name": name, "mesh_error": str(exc)})
            continue
        primitives = []
        mat_idx = material_index(obj, name)
        total_vertices = 0
        total_triangles = 0
        for vertices, normals, indices in chunks:
            if not vertices or not indices:
                continue
            gltf_vertices = [_freecad_point_to_gltf(vertex) for vertex in vertices]
            gltf_normals = [_freecad_normal_to_gltf(normal) for normal in normals]
            pos_min, pos_max = _minmax_vec3(gltf_vertices)
            pos_off = len(binout)
            pos_bytes = _pack_f32([value for vertex in gltf_vertices for value in vertex])
            binout += pos_bytes
            while len(binout) % 4:
                binout.append(0)
            norm_off = len(binout)
            norm_bytes = _pack_f32([value for normal in gltf_normals for value in normal])
            binout += norm_bytes
            while len(binout) % 4:
                binout.append(0)
            idx_off = len(binout)
            idx_bytes = _pack_u16(indices)
            binout += idx_bytes
            while len(binout) % 4:
                binout.append(0)
            bv_pos = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_bytes), "byteStride": 12, "target": 34962})
            bv_norm = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": norm_off, "byteLength": len(norm_bytes), "byteStride": 12, "target": 34962})
            bv_idx = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_bytes), "target": 34963})
            acc_pos = len(accessors)
            accessors.append({"bufferView": bv_pos, "componentType": 5126, "count": len(vertices), "type": "VEC3", "min": pos_min, "max": pos_max})
            acc_norm = len(accessors)
            accessors.append({"bufferView": bv_norm, "componentType": 5126, "count": len(normals), "type": "VEC3"})
            acc_idx = len(accessors)
            accessors.append({"bufferView": bv_idx, "componentType": 5123, "count": len(indices), "type": "SCALAR", "min": [0], "max": [len(vertices) - 1]})
            primitives.append({"attributes": {"POSITION": acc_pos, "NORMAL": acc_norm}, "indices": acc_idx, "mode": 4, "material": mat_idx})
            total_vertices += len(vertices)
            total_triangles += len(indices) // 3
        if not primitives:
            continue
        mesh_index = len(meshes)
        meshes.append({"name": f"{name}_mesh", "primitives": primitives})
        node_index = len(nodes)
        nodes.append({"name": name, "mesh": mesh_index, "extras": {"component_id": name if name.startswith("P") else None}})
        nodes[0]["children"].append(node_index)
        component_summaries.append({
            "name": name,
            "primitive_count": len(primitives),
            "vertices": total_vertices,
            "triangles": total_triangles,
            "source_mesh_points": mesh_points,
            "source_mesh_triangles": mesh_triangles,
        })

    gltf = {
        "asset": {"version": "2.0", "generator": "hybrid App::Link component-node low-complexity GLB exporter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials or [{"name": "default"}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(binout)}],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = _align4(len(json_bytes)) - len(json_bytes)
    bin_pad = _align4(len(binout)) - len(binout)
    total = 12 + 8 + len(json_bytes) + json_pad + 8 + len(binout) + bin_pad
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    out += struct.pack("<I4s", len(json_bytes) + json_pad, b"JSON") + json_bytes + b" " * json_pad
    out += struct.pack("<I4s", len(binout) + bin_pad, b"BIN\x00") + binout + b"\0" * bin_pad
    glb_path.write_bytes(out)
    return {
        "glb_path": str(glb_path),
        "glb_size_bytes": glb_path.stat().st_size,
        "node_count": len(nodes),
        "mesh_count": len(meshes),
        "material_count": len(materials),
        "accessor_count": len(accessors),
        "buffer_view_count": len(buffer_views),
        "component_count": len(component_summaries),
        "component_summaries": component_summaries,
        "linear_deflection": COMPONENT_GLB_LINEAR_DEFLECTION,
        "angular_deflection": COMPONENT_GLB_ANGULAR_DEFLECTION,
        "max_vertices_per_primitive": COMPONENT_GLB_MAX_VERTICES,
        "export_seconds": time.monotonic() - started,
    }


doc = FreeCAD.getDocument(DOC_NAME)
assembly = doc.getObject("Assembly")
if assembly is None:
    raise RuntimeError("Assembly object not found")

data = json.loads(Path(NORMALIZED_INPUT).read_text(encoding="utf-8"))
groups = repeated_step_groups(data)
component_to_step_path = {
    normalized_id(component_id): step_path
    for step_path, items in groups.items()
    for component_id, _component in items
}
remove_previous_linked_export_objects(doc)
doc.recompute()

export_parts = []
renamed = []
skipped = []
replaced_originals = []
wall_export_count = 0
for obj in list(getattr(assembly, "Group", []) or []):
    if obj.Name == "Envelope_part" or getattr(obj, "Label", "") == "Envelope_part":
        if INCLUDE_ENVELOPE:
            export_parts.append(obj)
        else:
            skipped.append(obj.Name)
        continue
    if obj.Name == "Walls_part" or getattr(obj, "Label", "") == "Walls_part":
        wall_export_count = len(getattr(obj, "Group", []) or [])
        export_parts.append(obj)
        continue
    ids = object_ids(obj)
    if ids & set(component_to_step_path):
        replaced_originals.append(obj.Name)
        continue
    rename = label_original_component(obj)
    if rename:
        renamed.append(rename)
    export_parts.append(obj)

linked_groups = []
linked_instance_count = 0
link_errors = []
for index, (step_path, items) in enumerate(sorted(groups.items()), start=1):
    shared_component_local_face = canonical_component_local_face(items)
    orientation_groups = {}
    for component_id, component in items:
        patched_component = placement_with_component_local_face(component, shared_component_local_face)
        rotation_rows = orientation_rows_from_normalized_placement(patched_component.get("placement") or {})
        orientation_key = tuple(tuple(float(value) for value in row) for row in rotation_rows)
        orientation_groups.setdefault(orientation_key, []).append((component_id, patched_component, rotation_rows))

    created_for_step = []
    orientation_summaries = []
    for orientation_index, (orientation_key, orientation_items) in enumerate(sorted(orientation_groups.items()), start=1):
        template_index = (index * 1000) + orientation_index
        rotation_rows = orientation_items[0][2]
        imported = import_step_template(doc, step_path, template_index, rotation_rows)
        if imported is None:
            link_errors.append({"step_path": step_path, "orientation_index": orientation_index, "reason": "template_import_failed"})
            continue
        template_object, template_bbox, shape_object_count = imported
        linked_root = doc.addObject("App::Part", f"LinkedSTEPGroup_{template_index:03d}")
        linked_root.Label = f"LinkedSTEPGroup__{template_index:03d}__{Path(step_path).name}"
        created = []
        for component_id, component, _rotation_rows in orientation_items:
            try:
                item = create_link_for_component(doc, linked_root, template_object, template_bbox, component_id, component)
                item["rotation_rows"] = rotation_rows
                created.append(item)
            except Exception as exc:
                link_errors.append({"step_path": step_path, "component_id": component_id, "reason": str(exc)})
        if not created:
            continue
        export_parts.append(linked_root)
        linked_instance_count += len(created)
        created_for_step.extend(created)
        orientation_summaries.append(
            {
                "orientation_index": orientation_index,
                "rotation_rows": rotation_rows,
                "instance_count": len(created),
                "component_ids": [item["component_id"] for item in created],
            }
        )
    if created_for_step:
        linked_groups.append(
            {
                "step_path": step_path,
                "instance_count": len(created_for_step),
                "orientation_group_count": len(orientation_summaries),
                "shared_component_local_face": shared_component_local_face,
                "shape_object_count": shape_object_count,
                "component_ids": [item["component_id"] for item in created_for_step],
                "orientation_groups": orientation_summaries,
                "instances": created_for_step,
            }
        )

Path(OUT_STEP).parent.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
Import.export(export_parts, OUT_STEP)
step_export_seconds = time.monotonic() - started

component_glb_summary = None
glb_error = None
if EXPORT_GLB:
    try:
        component_glb_summary = export_component_node_glb(export_parts, OUT_GLB)
    except Exception as exc:
        OUT_GLB = None
        glb_error = str(exc)
else:
    OUT_GLB = None

text = Path(OUT_STEP).read_text(errors="ignore")
payload = {
    "success": True,
    "document": doc.Name,
    "mode": "linked_assembly_with_envelope" if INCLUDE_ENVELOPE else "linked_assembly_no_envelope",
    "step_path": OUT_STEP,
    "glb_path": OUT_GLB,
    "normalized_input": NORMALIZED_INPUT,
    "component_export_count": len(export_parts),
    "wall_export_count": wall_export_count,
    "original_component_export_count": len(export_parts) - len(linked_groups),
    "linked_group_count": len(linked_groups),
    "linked_instance_count": linked_instance_count,
    "replaced_original_component_count": len(replaced_originals),
    "replaced_original_components": replaced_originals,
    "linked_groups": linked_groups,
    "link_errors": link_errors,
    "skipped_objects": skipped,
    "replacement_count": len(renamed),
    "renamed_replacements": renamed,
    "glb_error": glb_error,
    "component_glb_summary": component_glb_summary,
    "step_size_bytes": Path(OUT_STEP).stat().st_size if Path(OUT_STEP).exists() else None,
    "step_export_seconds": step_export_seconds,
    "step_counts": {
        "NEXT_ASSEMBLY_USAGE_OCCURRENCE": text.count("NEXT_ASSEMBLY_USAGE_OCCURRENCE"),
        "MANIFOLD_SOLID_BREP": text.count("MANIFOLD_SOLID_BREP"),
        "ADVANCED_BREP_SHAPE_REPRESENTATION": text.count("ADVANCED_BREP_SHAPE_REPRESENTATION"),
        "SHAPE_REPRESENTATION_RELATIONSHIP": text.count("SHAPE_REPRESENTATION_RELATIONSHIP"),
    },
}
Path(SUMMARY).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(payload, ensure_ascii=False))

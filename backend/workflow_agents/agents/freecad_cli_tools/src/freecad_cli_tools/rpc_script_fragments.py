"""Reusable FreeCAD-side code fragments for embedded RPC scripts."""

PLACEMENT_HELPERS = r"""
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
"""


COMPONENT_SHAPE_HELPERS = r"""
import itertools

# NOTE: Several functions in this fragment have canonical Python equivalents in
# freecad_cli_tools.geometry.  The string versions here are required because
# they execute inside FreeCAD's embedded Python, which cannot import CLI-side
# modules.  See tests/test_fragment_sync.py for a cross-validation test.
#
# Fragment function                      -> geometry.py equivalent
# -----------------------------------------------------------------------
# IDENTITY_ROTATION_ROWS                 -> IDENTITY_ROTATION
# CYLINDER_AXIS_ROTATION_ROWS            -> CYLINDER_AXIS_ROTATIONS
# FACE_DEFINITIONS                       -> FACE_DEFINITIONS
# apply_rotation_rows()                  -> apply_rotation()
# multiply_rotation_rows()               -> multiply_rotation_matrices()
# orientation_rows_from_placement()      -> orientation_rows_from_placement()
# cylinder_axis_index()                  -> cylinder_axis_index()
# cylinder_base_center_offset()          -> cylinder_base_center_offset()
# infer_cylinder_radius_and_height()     -> infer_cylinder_radius_and_height()
# translate_position()                   -> vector_add + apply_rotation
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
FACE_TOKEN_TO_ID = {
    "xmin": 0,
    "xmax": 1,
    "ymin": 2,
    "ymax": 3,
    "zmin": 4,
    "zmax": 5,
}
IDENTITY_ROTATION_ROWS = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
]
CYLINDER_AXIS_ROTATION_ROWS = {
    0: [
        [0.0, 0.0, 1.0],
        [0.0, 1.0, 0.0],
        [-1.0, 0.0, 0.0],
    ],
    1: [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, -1.0, 0.0],
    ],
    2: IDENTITY_ROTATION_ROWS,
}


def normalize_rotation_rows(rotation_rows):
    rows = rotation_rows or IDENTITY_ROTATION_ROWS
    return [[float(value) for value in row] for row in rows]


def apply_rotation_rows(rotation_rows, point):
    return [
        sum(rotation_rows[row][col] * float(point[col]) for col in range(3))
        for row in range(3)
    ]


def translate_position(position, rotation_rows, local_offset):
    rotated_offset = apply_rotation_rows(rotation_rows, local_offset)
    return [float(position[i]) + rotated_offset[i] for i in range(3)]


def multiply_rotation_rows(left_rows, right_rows):
    return [
        [
            sum(float(left_rows[row][k]) * float(right_rows[k][col]) for k in range(3))
            for col in range(3)
        ]
        for row in range(3)
    ]


def face_token_after_dot(value, field_name):
    if not isinstance(value, str) or "." not in value:
        raise RuntimeError(f"{field_name} must be a dotted face id, got {value!r}")
    return value.rsplit(".", 1)[1].strip().lower()


def parse_layout_mount_face_id(face_id):
    token = face_token_after_dot(face_id, "mount_face_id")
    if token in FACE_TOKEN_TO_ID:
        return FACE_TOKEN_TO_ID[token]
    if token.endswith("_inner"):
        inner = token[: -len("_inner")]
        if inner in FACE_TOKEN_TO_ID:
            return FACE_TOKEN_TO_ID[inner]
    if token.endswith("_outer"):
        outer = token[: -len("_outer")]
        if outer in FACE_TOKEN_TO_ID:
            return FACE_TOKEN_TO_ID[outer] + 6
    raise RuntimeError(f"Unsupported mount_face_id: {face_id!r}")


def parse_component_mount_face_id(face_id):
    token = face_token_after_dot(face_id, "component_mount_face_id")
    if not token.startswith("local_"):
        raise RuntimeError(f"Unsupported component_mount_face_id: {face_id!r}")
    local_token = token[len("local_") :]
    if local_token not in FACE_TOKEN_TO_ID:
        raise RuntimeError(f"Unsupported component_mount_face_id: {face_id!r}")
    return FACE_TOKEN_TO_ID[local_token]


def is_external_face(face_id):
    return int(face_id) >= 6


def face_normal(face_id):
    _, axis, direction = FACE_DEFINITIONS[int(face_id)]
    normal = [0.0, 0.0, 0.0]
    normal[axis] = float(direction)
    return normal


def determinant3(matrix_rows):
    return (
        matrix_rows[0][0]
        * (
            matrix_rows[1][1] * matrix_rows[2][2]
            - matrix_rows[1][2] * matrix_rows[2][1]
        )
        - matrix_rows[0][1]
        * (
            matrix_rows[1][0] * matrix_rows[2][2]
            - matrix_rows[1][2] * matrix_rows[2][0]
        )
        + matrix_rows[0][2]
        * (
            matrix_rows[1][0] * matrix_rows[2][1]
            - matrix_rows[1][1] * matrix_rows[2][0]
        )
    )


def signed_permutation_rotations():
    rotations = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1, 1), repeat=3):
            matrix_rows = [[0.0, 0.0, 0.0] for _ in range(3)]
            for row, col in enumerate(perm):
                matrix_rows[row][col] = float(signs[row])
            if determinant3(matrix_rows) == 1:
                rotations.append(matrix_rows)
    return rotations


ROTATION_ROWS = signed_permutation_rotations()


def installation_contact_world_face(install_face):
    install_face = int(install_face)
    if is_external_face(install_face):
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


def orientation_rows_from_placement(component_id, placement):
    mount_face_id = placement.get("mount_face_id")
    if not isinstance(mount_face_id, str) or not mount_face_id.strip():
        raise RuntimeError(f"Component {component_id} is missing placement.mount_face_id.")
    component_mount_face_id = placement.get("component_mount_face_id")
    if not isinstance(component_mount_face_id, str) or not component_mount_face_id.strip():
        raise RuntimeError(
            f"Component {component_id} is missing placement.component_mount_face_id."
        )
    install_face = parse_layout_mount_face_id(mount_face_id)
    component_face = parse_component_mount_face_id(component_mount_face_id)
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


def cylinder_axis_index(component_mount_face_id):
    if isinstance(component_mount_face_id, (int, float)):
        return FACE_DEFINITIONS[int(component_mount_face_id)][1]
    return FACE_DEFINITIONS[parse_component_mount_face_id(component_mount_face_id)][1]


def cylinder_base_center_offset(axis_index, radius):
    offsets = {
        0: [0.0, radius, radius],
        1: [radius, 0.0, radius],
        2: [radius, radius, 0.0],
    }
    return offsets[axis_index]


def infer_cylinder_radius_and_height(component_id, dims, radius, height, axis_index):
    dims_values = None if dims is None else [float(value) for value in dims]

    if dims_values is not None and len(dims_values) not in (2, 3):
        raise RuntimeError(
            "Cylinder component "
            f"{component_id} requires two or three dims values when dims are used."
        )

    if radius is None:
        if dims_values is None:
            raise RuntimeError(
                f"Cylinder component {component_id} requires radius or dims values."
            )
        if len(dims_values) == 2:
            radius = dims_values[0] / 2.0
        else:
            cross_section = [dims_values[index] for index in range(3) if index != axis_index]
            radius = min(cross_section) / 2.0
    else:
        radius = float(radius)

    if height is None:
        if dims_values is None:
            raise RuntimeError(
                f"Cylinder component {component_id} requires height or dims values."
            )
        if len(dims_values) == 2:
            height = dims_values[1]
        else:
            height = dims_values[axis_index]
    else:
        height = float(height)

    return radius, height


def build_component_shape_spec(component_id, component):
    shape = component.get("shape", "box")
    placement = component.get("placement", {})
    if "position" not in placement:
        raise RuntimeError(f"Missing placement.position for {component_id}")

    position = [float(value) for value in placement["position"]]
    rotation_rows = orientation_rows_from_placement(component_id, placement)
    dims = component.get("dims")

    if shape == "box":
        if dims is None or len(dims) != 3:
            raise RuntimeError(f"Box component {component_id} requires three dims values.")
        dims = [float(value) for value in dims]
        return {
            "shape": "box",
            "object_type": "Part::Box",
            "placement_position": position,
            "rotation_rows": rotation_rows,
            "length": dims[0],
            "width": dims[1],
            "height": dims[2],
        }

    if shape == "cylinder":
        placement_rotation_rows = orientation_rows_from_placement(component_id, placement)
        axis_index = cylinder_axis_index(placement.get("component_mount_face_id"))
        radius, height = infer_cylinder_radius_and_height(
            component_id,
            dims,
            component.get("radius"),
            component.get("height"),
            axis_index,
        )

        if radius <= 0.0 or height <= 0.0:
            raise RuntimeError(
                f"Cylinder component {component_id} requires positive radius and height."
            )

        placement_position = translate_position(
            position,
            placement_rotation_rows,
            cylinder_base_center_offset(axis_index, radius),
        )
        placement_rotation_rows = multiply_rotation_rows(
            placement_rotation_rows,
            CYLINDER_AXIS_ROTATION_ROWS[axis_index],
        )
        return {
            "shape": "cylinder",
            "object_type": "Part::Cylinder",
            "placement_position": placement_position,
            "rotation_rows": placement_rotation_rows,
            "radius": radius,
            "height": height,
            "angle": 360.0,
        }

    raise RuntimeError(f"Unsupported shape for {component_id}: {shape}")
"""

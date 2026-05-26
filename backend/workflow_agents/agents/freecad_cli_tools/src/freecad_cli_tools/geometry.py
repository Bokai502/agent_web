"""Pure geometry, collision detection, and component-shape helpers.

These functions are stateless and depend only on the standard library.
They may be imported by CLI entry points, test suites, and future
modules without pulling in PyYAML or RPC dependencies.
"""

from __future__ import annotations

import itertools
import math
from copy import deepcopy

from freecad_cli_tools.layout_dataset_common import FACE_ID_TO_TOKEN, FACE_TOKEN_TO_ID

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EPSILON = 1e-9

FACE_DEFINITIONS = {
    # Internal faces (0–5): component is mounted inside the envelope.
    0: ("-x", 0, -1),
    1: ("x", 0, 1),
    2: ("-y", 1, -1),
    3: ("y", 1, 1),
    4: ("-z", 2, -1),
    5: ("z", 2, 1),
    # External faces (6–11): component is mounted on the outside of the envelope.
    # Each external face mirrors its internal counterpart (face N mirrors face N-6).
    6: ("ext-x", 0, -1),
    7: ("ext+x", 0, 1),
    8: ("ext-y", 1, -1),
    9: ("ext+y", 1, 1),
    10: ("ext-z", 2, -1),
    11: ("ext+z", 2, 1),
}


def is_external_face(face_id: int) -> bool:
    """Return True if face_id refers to an external envelope face (6–11)."""
    return face_id >= 6


def component_contact_face(install_face: int) -> int:
    """Return the component's own face (0–5) that physically contacts the wall.

    For internal faces (0–5) the install face and contact face are the same.
    For external faces (6–11) the component wraps around the outer wall, so the
    contact face is the *opposite* of the corresponding internal face:
    e.g. external +Y (9) → contact face is internal -Y (2).
    """
    if is_external_face(install_face):
        return (install_face - 6) ^ 1
    return install_face


IDENTITY_ROTATION = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
]

CYLINDER_AXIS_ROTATIONS = {
    0: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    1: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
    2: IDENTITY_ROTATION,
}

FALLBACK_SAMPLE_COUNT = 256
FALLBACK_BISECTION_STEPS = 24

# ---------------------------------------------------------------------------
# Vector operations
# ---------------------------------------------------------------------------


def vector_add(a: list[float], b: list[float]) -> list[float]:
    return [a[i] + b[i] for i in range(3)]


def vector_scale(vector: list[float], factor: float) -> list[float]:
    return [factor * vector[i] for i in range(3)]


# ---------------------------------------------------------------------------
# Matrix operations
# ---------------------------------------------------------------------------


def determinant3(matrix: list[list[int]]) -> int:
    return (
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
        - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
        + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    )


def signed_permutation_rotations() -> list[list[list[int]]]:
    rotations = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1, 1), repeat=3):
            matrix = [[0, 0, 0] for _ in range(3)]
            for row, col in enumerate(perm):
                matrix[row][col] = signs[row]
            if determinant3(matrix) == 1:
                rotations.append(matrix)
    return rotations


ROTATIONS = signed_permutation_rotations()


def apply_rotation(matrix: list[list[int]], point: list[float]) -> list[float]:
    return [sum(matrix[row][col] * point[col] for col in range(3)) for row in range(3)]


def multiply_rotation_matrices(left: list[list[int]], right: list[list[int]]) -> list[list[int]]:
    return [
        [sum(left[row][k] * right[k][col] for k in range(3)) for col in range(3)]
        for row in range(3)
    ]


def normalize_spin_quarter_turns(angle_degrees: float) -> int:
    """Convert a spin angle in degrees to quarter turns."""
    quarter_turns = angle_degrees / 90.0
    rounded = round(quarter_turns)
    if not math.isclose(quarter_turns, rounded, abs_tol=EPSILON):
        raise ValueError("Spin angle must be a multiple of 90 degrees.")
    return int(rounded) % 4


def rotation_about_axis(axis_index: int, quarter_turns: int) -> list[list[int]]:
    """Return a right-handed quarter-turn rotation matrix around a world axis."""
    turns = quarter_turns % 4
    if turns == 0:
        return [row[:] for row in IDENTITY_ROTATION]

    if axis_index == 0:
        step = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
    elif axis_index == 1:
        step = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]
    elif axis_index == 2:
        step = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    else:
        raise ValueError(f"Invalid rotation axis index {axis_index!r}.")

    result = [row[:] for row in IDENTITY_ROTATION]
    for _ in range(turns):
        result = multiply_rotation_matrices(step, result)
    return result


def apply_in_plane_spin(
    *,
    base_rotation: list[list[int]],
    target_envelope_face: int,
    spin_quarter_turns: int,
) -> list[list[int]]:
    """Apply an in-plane quarter-turn spin around the target face normal."""
    _, axis_index, direction = FACE_DEFINITIONS[target_envelope_face]
    signed_turns = spin_quarter_turns if direction > 0 else -spin_quarter_turns
    spin_rotation = rotation_about_axis(axis_index, signed_turns)
    return multiply_rotation_matrices(spin_rotation, base_rotation)


def infer_in_plane_rotation_deg(
    component_face: int,
    target_envelope_face: int,
    orientation_rows: list[list[int]],
) -> float:
    base_rotation = rotation_for_component_contact_face(
        component_face,
        target_envelope_face,
    )
    normalized = [[int(value) for value in row] for row in orientation_rows]
    for spin_quarter_turns in range(4):
        candidate = apply_in_plane_spin(
            base_rotation=base_rotation,
            target_envelope_face=target_envelope_face,
            spin_quarter_turns=spin_quarter_turns,
        )
        if candidate == normalized:
            return float(spin_quarter_turns * 90)
    raise ValueError(
        "Orientation rows cannot be represented by mount-face ids plus a quarter-turn spin."
    )


# ---------------------------------------------------------------------------
# Component data accessors
# ---------------------------------------------------------------------------


def component_shape(component: dict) -> str:
    return str(component.get("shape", "box")).strip().lower()


def _face_token_after_dot(value: str, field_name: str) -> str:
    if not isinstance(value, str) or "." not in value:
        raise ValueError(f"{field_name} must be a dotted face id.")
    return value.rsplit(".", 1)[1].strip().lower()


def _parse_mount_face_id(face_id: str) -> int:
    token = _face_token_after_dot(face_id, "placement.mount_face_id")
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
    raise ValueError(f"Unsupported mount_face_id {face_id!r}.")


def _parse_component_mount_face_id(face_id: str) -> int:
    token = _face_token_after_dot(
        face_id,
        "placement.component_mount_face_id",
    )
    if not token.startswith("local_"):
        raise ValueError(f"Unsupported component_mount_face_id {face_id!r}.")
    local_token = token[len("local_") :]
    if local_token not in FACE_TOKEN_TO_ID:
        raise ValueError(f"Unsupported component_mount_face_id {face_id!r}.")
    return FACE_TOKEN_TO_ID[local_token]


def face_id_to_local_component_face_id(component_id: str, face_id: int) -> str:
    return f"{component_id}.local_{FACE_ID_TO_TOKEN[face_id]}"


def face_id_to_generic_mount_face_id(face_id: int) -> str:
    token = FACE_ID_TO_TOKEN[face_id % 6]
    if is_external_face(face_id):
        return f"outer.{token}_outer"
    return f"outer.{token}_inner"


def orientation_rows_from_placement(
    component_id: str,
    placement: dict,
) -> list[list[int]]:
    mount_face_id = placement.get("mount_face_id")
    if not isinstance(mount_face_id, str) or not mount_face_id.strip():
        legacy_rotation_rows = placement.get("rotation_matrix")
        if legacy_rotation_rows is not None:
            return normalize_legacy_orientation_rows(
                legacy_rotation_rows,
                field_name="placement.rotation_matrix",
            )
        return [row[:] for row in IDENTITY_ROTATION]
    component_mount_face_id = placement.get("component_mount_face_id")
    if not isinstance(component_mount_face_id, str) or not component_mount_face_id.strip():
        raise ValueError(
            f"Component {component_id!r} is missing placement.component_mount_face_id."
        )

    install_face = _parse_mount_face_id(mount_face_id)
    component_face = _parse_component_mount_face_id(component_mount_face_id)
    orientation_rows = rotation_for_component_contact_face(component_face, install_face)
    alignment = placement.get("alignment") or {}
    if not isinstance(alignment, dict):
        raise ValueError(f"Component {component_id!r} placement.alignment must be an object.")
    spin_degrees = float(alignment.get("in_plane_rotation_deg", 0.0) or 0.0)
    if abs(spin_degrees) > EPSILON:
        orientation_rows = apply_in_plane_spin(
            base_rotation=orientation_rows,
            target_envelope_face=install_face,
            spin_quarter_turns=normalize_spin_quarter_turns(spin_degrees),
        )
    return orientation_rows


def normalize_legacy_orientation_rows(
    rotation_rows: list[list[int]] | list[list[float]],
    *,
    field_name: str,
) -> list[list[int]]:
    if not isinstance(rotation_rows, list) or len(rotation_rows) != 3:
        raise ValueError(f"{field_name} must be a 3x3 matrix.")
    normalized: list[list[int]] = []
    for row in rotation_rows:
        if not isinstance(row, list) or len(row) != 3:
            raise ValueError(f"{field_name} must be a 3x3 matrix.")
        normalized.append([int(value) for value in row])
    return normalized


def orientation_rows_from_component(component: dict) -> list[list[int]]:
    """Return the component's world-frame orientation rows."""
    component_id = str(component.get("component_id") or component.get("id") or "component")
    return orientation_rows_from_placement(component_id, component.get("placement", {}))


def rotation_matrix_from_component(component: dict) -> list[list[int]]:
    """Backward-compatible alias for orientation_rows_from_component()."""
    return orientation_rows_from_component(component)


def installation_contact_world_face(install_face: int) -> int:
    """Return the world-facing direction a component contact face must align to."""
    if install_face not in FACE_DEFINITIONS:
        raise ValueError(f"Invalid install face {install_face!r}. Expected an integer in 0..11.")
    return (install_face - 6) ^ 1 if is_external_face(install_face) else install_face


def component_contact_face_from_component(component: dict) -> int:
    """Return the component-local contact face (always 0–5).

    The normalized placement stores the installation face and component-local
    contact face separately. Preserve that same physical component face across
    later face changes.
    """
    component_id = str(component.get("component_id") or component.get("id") or "component")
    placement = component.get("placement", {})
    component_mount_face_id = placement.get("component_mount_face_id")
    if isinstance(component_mount_face_id, str) and component_mount_face_id.strip():
        return _parse_component_mount_face_id(component_mount_face_id)

    legacy_install_face = placement.get("mount_face")
    if legacy_install_face not in FACE_DEFINITIONS:
        raise ValueError(
            f"Component {component_id!r} is missing placement.component_mount_face_id."
        )
    orientation_rows = orientation_rows_from_placement(component_id, placement)
    world_contact_face = installation_contact_world_face(int(legacy_install_face))
    world_contact_normal = face_normal(world_contact_face)
    for candidate_face in range(6):
        if apply_rotation(orientation_rows, face_normal(candidate_face)) == world_contact_normal:
            return candidate_face
    return component_contact_face(int(legacy_install_face))


def component_mount_face(component: dict) -> int:
    """Return the component's own contact face (always 0–5)."""
    return component_contact_face_from_component(component)


def envelope_face(component: dict) -> int:
    """Return the installation face (0–11) for a component."""
    placement = component.get("placement", {})
    face_id = placement.get("mount_face_id")
    if isinstance(face_id, str) and face_id.strip():
        return _parse_mount_face_id(face_id)
    legacy_face = placement.get("mount_face")
    if legacy_face in FACE_DEFINITIONS:
        return int(legacy_face)
    raise ValueError("placement.mount_face_id must be a non-empty string.")


def face_normal(face_id: int) -> list[int]:
    _, axis, direction = FACE_DEFINITIONS[face_id]
    vec = [0, 0, 0]
    vec[axis] = direction
    return vec


# ---------------------------------------------------------------------------
# Cylinder helpers
# ---------------------------------------------------------------------------


def cylinder_axis_index(mount_face: int) -> int:
    if mount_face not in FACE_DEFINITIONS:
        raise ValueError(
            f"Invalid or missing mount_face {mount_face!r}. Expected an integer in 0..11."
        )
    return FACE_DEFINITIONS[mount_face][1]


def infer_cylinder_radius_and_height(
    component_id: str,
    component: dict,
    axis_index: int,
) -> tuple[float, float]:
    dims = component.get("dims")
    dims_values = None if dims is None else [float(value) for value in dims]

    if dims_values is not None and len(dims_values) not in (2, 3):
        raise RuntimeError(
            "Cylinder component "
            f"{component_id} requires two or three dims values when dims are used."
        )

    radius = component.get("radius")
    height = component.get("height")

    if radius is None:
        if dims_values is None:
            raise RuntimeError(f"Cylinder component {component_id} requires radius or dims values.")
        if len(dims_values) == 2:
            radius = dims_values[0] / 2.0
        else:
            cross_section = [dims_values[index] for index in range(3) if index != axis_index]
            radius = min(cross_section) / 2.0
    else:
        radius = float(radius)

    if height is None:
        if dims_values is None:
            raise RuntimeError(f"Cylinder component {component_id} requires height or dims values.")
        if len(dims_values) == 2:
            height = dims_values[1]
        else:
            height = dims_values[axis_index]
    else:
        height = float(height)

    if radius <= 0.0 or height <= 0.0:
        raise RuntimeError(
            f"Cylinder component {component_id} requires positive radius and height."
        )

    return radius, height


def cylinder_base_center_offset(axis_index: int, radius: float) -> list[float]:
    offsets = {
        0: [0.0, radius, radius],
        1: [radius, 0.0, radius],
        2: [radius, radius, 0.0],
    }
    return offsets[axis_index]


# ---------------------------------------------------------------------------
# Component geometry (extents and solid placement)
# ---------------------------------------------------------------------------


def component_local_extents(component_id: str, component: dict) -> list[float]:
    shape = component_shape(component)
    dims = component.get("dims")

    if shape == "box":
        if dims is None or len(dims) != 3:
            raise RuntimeError(f"Box component {component_id} requires three dims values.")
        return [float(value) for value in dims]

    if shape == "cylinder":
        axis_index = cylinder_axis_index(component_mount_face(component))
        radius, height = infer_cylinder_radius_and_height(component_id, component, axis_index)
        diameter = radius * 2.0
        extents = [diameter, diameter, diameter]
        extents[axis_index] = height
        return extents

    raise RuntimeError(f"Unsupported shape for {component_id}: {shape}")


def component_solid_placement(
    component_id: str,
    component: dict,
    position: list[float],
    rotation_matrix: list[list[int]],
) -> tuple[list[float], list[list[int]]]:
    shape = component_shape(component)
    if shape == "box":
        return [float(value) for value in position], [
            [int(value) for value in row] for row in rotation_matrix
        ]

    if shape == "cylinder":
        axis_index = cylinder_axis_index(component_mount_face(component))
        radius, _ = infer_cylinder_radius_and_height(component_id, component, axis_index)
        offset = cylinder_base_center_offset(axis_index, radius)
        solid_position = vector_add(position, apply_rotation(rotation_matrix, offset))
        solid_rotation = multiply_rotation_matrices(
            rotation_matrix,
            CYLINDER_AXIS_ROTATIONS[axis_index],
        )
        return solid_position, solid_rotation

    raise RuntimeError(f"Unsupported shape for {component_id}: {shape}")


def local_face_centroid(dims: list[float], face_id: int) -> list[float]:
    _, axis, direction = FACE_DEFINITIONS[face_id]
    centroid = [dims[i] / 2.0 for i in range(3)]
    centroid[axis] = 0.0 if direction < 0 else dims[axis]
    return centroid


# ---------------------------------------------------------------------------
# Bounding box operations
# ---------------------------------------------------------------------------


def box_bounds(
    position: list[float],
    dims: list[float],
    rotation_matrix: list[list[int]],
) -> list[tuple[float, float]]:
    corners = []
    for x in (0.0, dims[0]):
        for y in (0.0, dims[1]):
            for z in (0.0, dims[2]):
                rotated = apply_rotation(rotation_matrix, [x, y, z])
                corners.append([position[i] + rotated[i] for i in range(3)])
    return [
        (min(point[i] for point in corners), max(point[i] for point in corners)) for i in range(3)
    ]


def boxes_overlap(
    a_position: list[float],
    a_dims: list[float],
    a_rotation: list[list[int]],
    b_position: list[float],
    b_dims: list[float],
    b_rotation: list[list[int]],
) -> bool:
    a_box = box_bounds(a_position, a_dims, a_rotation)
    b_box = box_bounds(b_position, b_dims, b_rotation)
    return all(
        a_box[i][0] < b_box[i][1] - EPSILON and b_box[i][0] < a_box[i][1] - EPSILON
        for i in range(3)
    )


def bounds_overlap(
    a_bounds: list[tuple[float, float]],
    b_bounds: list[tuple[float, float]],
) -> bool:
    return all(
        a_bounds[i][0] < b_bounds[i][1] - EPSILON and b_bounds[i][0] < a_bounds[i][1] - EPSILON
        for i in range(3)
    )


def translate_bounds(
    bounds: list[tuple[float, float]],
    offset: list[float],
) -> list[tuple[float, float]]:
    return [(bounds[i][0] + offset[i], bounds[i][1] + offset[i]) for i in range(3)]


def swept_bounds(
    start_bounds: list[tuple[float, float]],
    move: list[float],
    scale_low: float = 0.0,
    scale_high: float = 1.0,
) -> list[tuple[float, float]]:
    swept = []
    for axis in range(3):
        low_start = start_bounds[axis][0] + move[axis] * scale_low
        low_end = start_bounds[axis][0] + move[axis] * scale_high
        high_start = start_bounds[axis][1] + move[axis] * scale_low
        high_end = start_bounds[axis][1] + move[axis] * scale_high
        swept.append((min(low_start, low_end), max(high_start, high_end)))
    return swept


# ---------------------------------------------------------------------------
# Envelope containment
# ---------------------------------------------------------------------------


def inside_envelope(
    position: list[float],
    dims: list[float],
    inner_size: list[float],
    rotation_matrix: list[list[int]],
) -> bool:
    half_inner = [length / 2.0 for length in inner_size]
    bounds = box_bounds(position, dims, rotation_matrix)
    for axis in range(3):
        low, high = bounds[axis]
        if low < -half_inner[axis] - EPSILON or high > half_inner[axis] + EPSILON:
            return False
    return True


def inside_envelope_bounds(
    bounds: list[tuple[float, float]],
    inner_size: list[float],
) -> bool:
    half_inner = [length / 2.0 for length in inner_size]
    for axis in range(3):
        low, high = bounds[axis]
        if low < -half_inner[axis] - EPSILON or high > half_inner[axis] + EPSILON:
            return False
    return True


def inside_face_in_plane_bounds(
    bounds: list[tuple[float, float]],
    wall_size: list[float],
    face_id: int,
) -> bool:
    """Return True if the component's in-plane extents fit within the face's 2D boundary.

    Only the two axes perpendicular to the face normal are checked; the normal
    axis (depth) is unconstrained by this function.
    """
    _, axis, _ = FACE_DEFINITIONS[face_id]
    half_wall = [length / 2.0 for length in wall_size]
    for in_plane_axis in range(3):
        if in_plane_axis == axis:
            continue
        low, high = bounds[in_plane_axis]
        if low < -half_wall[in_plane_axis] - EPSILON or high > half_wall[in_plane_axis] + EPSILON:
            return False
    return True


# ---------------------------------------------------------------------------
# Placement geometry
# ---------------------------------------------------------------------------


def get_face_data(face_id: int) -> tuple[int, str, int, int]:
    label, axis, direction = FACE_DEFINITIONS[face_id]
    return face_id, label, axis, direction


def constrain_position_to_envelope_face(
    position: list[float],
    dims: list[float],
    wall_size: list[float],
    face_id: int,
    rotation_matrix: list[list[int]],
) -> list[float]:
    _, axis, direction = FACE_DEFINITIONS[face_id]
    target_contact = -wall_size[axis] / 2.0 if direction < 0 else wall_size[axis] / 2.0
    bounds = box_bounds(position, dims, rotation_matrix)
    # For external faces the component sits *outside* the wall, so the near edge
    # (opposite sign) is the one that must touch the outer surface.
    effective_direction = -direction if is_external_face(face_id) else direction
    current_contact = bounds[axis][0] if effective_direction < 0 else bounds[axis][1]
    constrained = list(position)
    constrained[axis] += target_contact - current_contact
    return constrained


def choose_rotation(component_face: int, target_envelope_face: int) -> list[list[int]]:
    source = face_normal(component_face)
    target = face_normal(target_envelope_face)
    candidates = [matrix for matrix in ROTATIONS if apply_rotation(matrix, source) == target]
    if not candidates:
        raise RuntimeError("No valid orthogonal rotation found for requested face change.")
    candidates.sort(key=lambda matrix: sum(matrix[i][i] for i in range(3)), reverse=True)
    return candidates[0]


def rotation_for_component_contact_face(
    component_contact_face: int,
    target_envelope_face: int,
) -> list[list[int]]:
    """Rotate one component-local contact face onto a box/envelope face.

    For external installation faces, the component contact face points inward,
    opposite the outward box face normal. The target direction is therefore the
    mirrored internal face.
    """
    rotation_target = installation_contact_world_face(target_envelope_face)
    return choose_rotation(component_contact_face, rotation_target)


def position_for_mount_point(
    mount_point: list[float],
    dims: list[float],
    mount_face: int,
    rotation_matrix: list[list[int]],
) -> list[float]:
    centroid_local = local_face_centroid(dims, mount_face)
    centroid_world = apply_rotation(rotation_matrix, centroid_local)
    return [mount_point[i] - centroid_world[i] for i in range(3)]


def mount_point_from_component(component_id: str, component: dict) -> list[float]:
    placement = component.get("placement", {})
    extents = component_local_extents(component_id, component)
    computed_mount_point = compute_mount_point(
        [float(value) for value in placement["position"]],
        extents,
        component_mount_face(component),
        rotation_matrix_from_component(component),
    )
    mount_point = placement.get("mount_point")
    if mount_point is None:
        return computed_mount_point
    stored_mount_point = [float(value) for value in mount_point]
    if any(
        abs(stored_mount_point[index] - computed_mount_point[index]) > EPSILON for index in range(3)
    ):
        return computed_mount_point
    return stored_mount_point


def centered_face_position(
    dims: list[float],
    wall_size: list[float],
    component_face: int,
    target_envelope_face: int,
) -> tuple[list[float], list[float], list[list[int]]]:
    rotation = rotation_for_component_contact_face(
        component_face,
        target_envelope_face,
    )
    _, axis, direction = FACE_DEFINITIONS[target_envelope_face]
    mount_point = [0.0, 0.0, 0.0]
    mount_point[axis] = (-wall_size[axis] / 2.0) if direction < 0 else (wall_size[axis] / 2.0)
    position = position_for_mount_point(mount_point, dims, component_face, rotation)
    return position, mount_point, rotation


def project_move_to_mount_plane(move: list[float], axis: int) -> tuple[list[float], bool]:
    projected = list(move)
    ignored = abs(projected[axis]) > EPSILON
    projected[axis] = 0.0
    return projected, ignored


def compute_mount_point(
    position: list[float],
    dims: list[float],
    mount_face: int,
    rotation_matrix: list[list[int]],
) -> list[float]:
    centroid = local_face_centroid(dims, mount_face)
    rotated = apply_rotation(rotation_matrix, centroid)
    return [position[i] + rotated[i] for i in range(3)]


# ---------------------------------------------------------------------------
# Analysis context
# ---------------------------------------------------------------------------


def build_analysis_context(
    data: dict,
    component_id: str,
    rotation_matrix: list[list[int]],
    check_envelope: bool = True,
    envelope_face_id: int | None = None,
    wall_size: list[float] | None = None,
) -> dict:
    components = data["components"]
    target = components[component_id]
    target_extents = component_local_extents(component_id, target)
    other_bounds = []
    for other_id, other in components.items():
        if other_id == component_id:
            continue
        other_bounds.append(
            (
                other_id,
                box_bounds(
                    other["placement"]["position"],
                    component_local_extents(other_id, other),
                    rotation_matrix_from_component(other),
                ),
            )
        )
    return {
        "target_extents": target_extents,
        "inner_size": data["envelope"]["inner_size"],
        "other_bounds": other_bounds,
        "check_envelope": check_envelope,
        "envelope_face_id": envelope_face_id,
        "wall_size": wall_size,
    }


def analyze_bounds(
    context: dict,
    bounds: list[tuple[float, float]],
    obstacle_bounds: list[tuple[str, list[tuple[float, float]]]] | None = None,
) -> tuple[bool, list[str]]:
    blockers: list[str] = []
    if context.get("check_envelope", True):
        if not inside_envelope_bounds(bounds, context["inner_size"]):
            blockers.append("ENVELOPE_BOUNDARY")
    envelope_face_id = context.get("envelope_face_id")
    wall_size = context.get("wall_size")
    if (
        envelope_face_id is not None
        and wall_size is not None
        and is_external_face(envelope_face_id)
        and not inside_face_in_plane_bounds(bounds, wall_size, envelope_face_id)
    ):
        blockers.append("FACE_BOUNDARY")
    for other_id, other_bounds in obstacle_bounds or context["other_bounds"]:
        if bounds_overlap(bounds, other_bounds):
            blockers.append(other_id)
    return len(blockers) == 0, blockers


def analyze_position(
    context: dict,
    position: list[float],
    rotation_matrix: list[list[int]],
) -> tuple[bool, list[str]]:
    bounds = box_bounds(position, context["target_extents"], rotation_matrix)
    return analyze_bounds(context, bounds)


def analyze_translated_bounds(
    context: dict,
    start_bounds: list[tuple[float, float]],
    move: list[float],
    scale: float,
    obstacle_bounds: list[tuple[str, list[tuple[float, float]]]] | None = None,
) -> tuple[bool, list[str]]:
    candidate_bounds = translate_bounds(start_bounds, vector_scale(move, scale))
    return analyze_bounds(context, candidate_bounds, obstacle_bounds=obstacle_bounds)


# ---------------------------------------------------------------------------
# Collision detection
# ---------------------------------------------------------------------------


def axis_overlap_interval(
    moving_low: float,
    moving_high: float,
    delta: float,
    static_low: float,
    static_high: float,
) -> tuple[float, float] | None:
    overlap_low = static_low + EPSILON
    overlap_high = static_high - EPSILON

    if delta == 0.0:
        if moving_low < overlap_high and moving_high > overlap_low:
            return (-math.inf, math.inf)
        return None

    first = (overlap_low - moving_high) / delta
    second = (overlap_high - moving_low) / delta
    low = min(first, second)
    high = max(first, second)
    return (low, high)


def interval_intersection(
    intervals: list[tuple[float, float]],
) -> tuple[float, float] | None:
    if not intervals:
        return None
    low = max(interval[0] for interval in intervals)
    high = min(interval[1] for interval in intervals)
    if low >= high:
        return None
    return (low, high)


def collision_interval_for_obstacle(
    start_bounds: list[tuple[float, float]],
    move: list[float],
    obstacle_bounds: list[tuple[float, float]],
) -> tuple[float, float] | None:
    intervals = []
    for axis in range(3):
        axis_interval = axis_overlap_interval(
            moving_low=start_bounds[axis][0],
            moving_high=start_bounds[axis][1],
            delta=move[axis],
            static_low=obstacle_bounds[axis][0],
            static_high=obstacle_bounds[axis][1],
        )
        if axis_interval is None:
            return None
        intervals.append(axis_interval)
    return interval_intersection(intervals)


def envelope_safe_interval(
    start_bounds: list[tuple[float, float]],
    move: list[float],
    inner_size: list[float],
) -> tuple[float, float] | None:
    low = 0.0
    high = 1.0
    half_inner = [length / 2.0 for length in inner_size]

    for axis in range(3):
        min_allowed = -half_inner[axis]
        max_allowed = half_inner[axis]
        bound_low = start_bounds[axis][0]
        bound_high = start_bounds[axis][1]
        delta = move[axis]

        if delta == 0.0:
            if bound_low < min_allowed - EPSILON or bound_high > max_allowed + EPSILON:
                return None
            continue

        limit_one = (min_allowed - bound_low) / delta
        limit_two = (max_allowed - bound_high) / delta
        axis_low = min(limit_one, limit_two)
        axis_high = max(limit_one, limit_two)
        low = max(low, axis_low)
        high = min(high, axis_high)
        if low > high:
            return None

    return (low, high)


def face_in_plane_safe_interval(
    start_bounds: list[tuple[float, float]],
    move: list[float],
    wall_size: list[float],
    face_id: int,
) -> tuple[float, float] | None:
    """Return the [low, high] scale interval for staying inside the face boundary.

    Only the two axes perpendicular to the face normal are constrained.
    Returns None if the starting position already violates the boundary.
    """
    _, axis, _ = FACE_DEFINITIONS[face_id]
    half_wall = [length / 2.0 for length in wall_size]
    low = 0.0
    high = 1.0

    for in_plane_axis in range(3):
        if in_plane_axis == axis:
            continue
        min_allowed = -half_wall[in_plane_axis]
        max_allowed = half_wall[in_plane_axis]
        bound_low = start_bounds[in_plane_axis][0]
        bound_high = start_bounds[in_plane_axis][1]
        delta = move[in_plane_axis]

        if delta == 0.0:
            if bound_low < min_allowed - EPSILON or bound_high > max_allowed + EPSILON:
                return None
            continue

        limit_one = (min_allowed - bound_low) / delta
        limit_two = (max_allowed - bound_high) / delta
        axis_low = min(limit_one, limit_two)
        axis_high = max(limit_one, limit_two)
        low = max(low, axis_low)
        high = min(high, axis_high)
        if low > high:
            return None

    return (low, high)


def broad_phase_obstacles(
    context: dict,
    start_bounds: list[tuple[float, float]],
    move: list[float],
    max_scale: float,
) -> list[tuple[str, list[tuple[float, float]]]]:
    path_bounds = swept_bounds(start_bounds, move, scale_high=max_scale)
    return [
        (other_id, other_bounds)
        for other_id, other_bounds in context["other_bounds"]
        if bounds_overlap(path_bounds, other_bounds)
    ]


def refine_safe_interval_end(
    context: dict,
    start_bounds: list[tuple[float, float]],
    move: list[float],
    safe_low: float,
    unsafe_high: float,
    obstacle_bounds: list[tuple[str, list[tuple[float, float]]]] | None = None,
    steps: int = FALLBACK_BISECTION_STEPS,
) -> float:
    low = safe_low
    high = unsafe_high
    for _ in range(steps):
        mid = (low + high) / 2.0
        ok, _ = analyze_translated_bounds(
            context,
            start_bounds,
            move,
            mid,
            obstacle_bounds=obstacle_bounds,
        )
        if ok:
            low = mid
        else:
            high = mid
    return low


def legacy_best_safe_scale(
    context: dict,
    start_bounds: list[tuple[float, float]],
    move: list[float],
    obstacle_bounds: list[tuple[str, list[tuple[float, float]]]] | None = None,
) -> float | None:
    safe_samples: list[float] = []
    for index in range(FALLBACK_SAMPLE_COUNT + 1):
        scale = index / FALLBACK_SAMPLE_COUNT
        ok, _ = analyze_translated_bounds(
            context,
            start_bounds,
            move,
            scale,
            obstacle_bounds=obstacle_bounds,
        )
        if ok:
            safe_samples.append(scale)

    if not safe_samples:
        return None

    best_sample = safe_samples[-1]
    if best_sample >= 1.0:
        return 1.0

    step = 1.0 / FALLBACK_SAMPLE_COUNT
    unsafe_high = min(1.0, best_sample + step)
    return refine_safe_interval_end(
        context=context,
        start_bounds=start_bounds,
        move=move,
        safe_low=best_sample,
        unsafe_high=unsafe_high,
        obstacle_bounds=obstacle_bounds,
    )


def find_best_safe_scale(
    context: dict,
    start: list[float],
    move: list[float],
    rotation_matrix: list[list[int]],
) -> float | None:
    start_bounds = box_bounds(start, context["target_extents"], rotation_matrix)
    start_ok, _ = analyze_bounds(context, start_bounds)
    if not start_ok:
        return legacy_best_safe_scale(context, start_bounds, move)

    envelope_face_id = context.get("envelope_face_id")
    wall_size = context.get("wall_size")
    if context.get("check_envelope", True):
        allowed_interval = envelope_safe_interval(start_bounds, move, context["inner_size"])
        if allowed_interval is None or allowed_interval[1] < 0.0:
            return None
        safe_low = max(0.0, allowed_interval[0])
        safe_high = min(1.0, allowed_interval[1])
        if not safe_low <= 0.0 <= safe_high:
            return legacy_best_safe_scale(context, start_bounds, move)
    elif (
        envelope_face_id is not None
        and wall_size is not None
        and is_external_face(envelope_face_id)
    ):
        allowed_interval = face_in_plane_safe_interval(
            start_bounds, move, wall_size, envelope_face_id
        )
        if allowed_interval is None or allowed_interval[1] < 0.0:
            return None
        safe_low = max(0.0, allowed_interval[0])
        safe_high = min(1.0, allowed_interval[1])
        if not safe_low <= 0.0 <= safe_high:
            return legacy_best_safe_scale(context, start_bounds, move)
    else:
        safe_high = 1.0

    candidate_obstacles = broad_phase_obstacles(context, start_bounds, move, safe_high)
    earliest_blocking_scale = safe_high
    for _, obstacle_bounds in candidate_obstacles:
        collision_interval = collision_interval_for_obstacle(start_bounds, move, obstacle_bounds)
        if collision_interval is None:
            continue
        block_low = collision_interval[0]
        block_high = collision_interval[1]
        if block_high <= 0.0 or block_low >= earliest_blocking_scale:
            continue
        earliest_blocking_scale = max(0.0, block_low)
        if earliest_blocking_scale <= 0.0:
            return 0.0

    candidate_scale = earliest_blocking_scale
    if candidate_scale >= 1.0:
        return 1.0

    candidate_ok, _ = analyze_translated_bounds(
        context,
        start_bounds,
        move,
        candidate_scale,
        obstacle_bounds=candidate_obstacles,
    )
    if candidate_ok:
        return candidate_scale

    return refine_safe_interval_end(
        context=context,
        start_bounds=start_bounds,
        move=move,
        safe_low=0.0,
        unsafe_high=candidate_scale,
        obstacle_bounds=candidate_obstacles,
    )


# ---------------------------------------------------------------------------
# Data transform
# ---------------------------------------------------------------------------


def update_component_placement(
    data: dict,
    component_id: str,
    position: list[float],
    install_face: int | None = None,
    *,
    component_mount_face: int | None = None,
    envelope_face_id: int | None = None,
    rotation_matrix: list[list[int]] | None = None,
) -> dict:
    """Return a copy of the assembly with one component's placement updated.

    The preferred call shape is ``update_component_placement(data, component_id, position,
    install_face)``. Legacy keyword arguments remain supported for older callers and tests:
    ``component_mount_face``, ``envelope_face_id``, and ``rotation_matrix``.
    """
    updated = deepcopy(data)
    component = updated["components"][component_id]
    extents = component_local_extents(component_id, component)
    preserved_component_contact_face = component_contact_face_from_component(component)
    if install_face is None:
        if envelope_face_id is None:
            raise ValueError("install_face or envelope_face_id is required.")
        install_face = envelope_face_id

    legacy_mode = component_mount_face is not None or envelope_face_id is not None
    mount_point_face = (
        component_mount_face
        if component_mount_face is not None
        else preserved_component_contact_face
    )
    orientation_rows = (
        rotation_matrix_from_component(component)
        if rotation_matrix is None
        else [[int(value) for value in row] for row in rotation_matrix]
    )
    try:
        in_plane_rotation_deg = infer_in_plane_rotation_deg(
            mount_point_face,
            int(install_face),
            orientation_rows,
        )
    except ValueError:
        if not legacy_mode:
            raise
        in_plane_rotation_deg = 0.0
    component["placement"]["position"] = position
    component["placement"].pop("mount_face", None)
    component["placement"].pop("envelope_face", None)
    component["placement"].pop("rotation_matrix", None)
    component["placement"]["mount_face_id"] = face_id_to_generic_mount_face_id(int(install_face))
    component["placement"]["component_mount_face_id"] = face_id_to_local_component_face_id(
        component_id,
        int(mount_point_face),
    )
    alignment = component["placement"].setdefault("alignment", {})
    alignment["normal_alignment"] = "opposite"
    alignment["component_u_axis_to_target_u_axis"] = True
    alignment["in_plane_rotation_deg"] = in_plane_rotation_deg
    component["placement"]["mount_point"] = compute_mount_point(
        position, extents, mount_point_face, orientation_rows
    )
    return updated

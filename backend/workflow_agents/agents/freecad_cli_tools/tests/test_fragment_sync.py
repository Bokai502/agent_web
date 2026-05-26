"""Cross-validation that rpc_script_fragments produce identical results to geometry.py.

The string fragments in rpc_script_fragments.py are duplicates of functions in
freecad_cli_tools.geometry.  They must stay as strings (FreeCAD-side execution),
but this test ensures they do not silently diverge.
"""

from __future__ import annotations

import pytest

from freecad_cli_tools.geometry import (
    CYLINDER_AXIS_ROTATIONS,
    IDENTITY_ROTATION,
    apply_rotation,
    cylinder_axis_index,
    cylinder_base_center_offset,
    infer_cylinder_radius_and_height,
    multiply_rotation_matrices,
    vector_add,
)
from freecad_cli_tools.rpc_script_fragments import COMPONENT_SHAPE_HELPERS


@pytest.fixture()
def fragment_ns() -> dict:
    """Execute the COMPONENT_SHAPE_HELPERS fragment and return its namespace."""
    ns: dict = {}
    exec(COMPONENT_SHAPE_HELPERS, ns)
    return ns


def _to_float_matrix(matrix: list[list[int | float]]) -> list[list[float]]:
    return [[float(v) for v in row] for row in matrix]


def test_identity_rotation_matches(fragment_ns: dict) -> None:
    assert fragment_ns["IDENTITY_ROTATION_ROWS"] == _to_float_matrix(IDENTITY_ROTATION)


def test_cylinder_axis_rotation_rows_match(fragment_ns: dict) -> None:
    frag_rotations = fragment_ns["CYLINDER_AXIS_ROTATION_ROWS"]
    for key in CYLINDER_AXIS_ROTATIONS:
        assert _to_float_matrix(CYLINDER_AXIS_ROTATIONS[key]) == _to_float_matrix(
            frag_rotations[key]
        ), f"Mismatch for axis {key}"


@pytest.mark.parametrize(
    "matrix,point",
    [
        (IDENTITY_ROTATION, [1.0, 2.0, 3.0]),
        ([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [1.0, 0.0, 0.0]),
        ([[0, -1, 0], [1, 0, 0], [0, 0, 1]], [3.0, 4.0, 5.0]),
    ],
)
def test_apply_rotation_rows_matches(
    fragment_ns: dict,
    matrix: list[list[int]],
    point: list[float],
) -> None:
    expected = apply_rotation(matrix, point)
    result = fragment_ns["apply_rotation_rows"](_to_float_matrix(matrix), point)
    assert result == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize(
    "left,right",
    [
        (IDENTITY_ROTATION, [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]),
        ([[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, -1], [0, 1, 0]]),
    ],
)
def test_multiply_rotation_rows_matches(
    fragment_ns: dict,
    left: list[list[int]],
    right: list[list[int]],
) -> None:
    expected = _to_float_matrix(multiply_rotation_matrices(left, right))
    result = _to_float_matrix(
        fragment_ns["multiply_rotation_rows"](_to_float_matrix(left), _to_float_matrix(right))
    )
    for row_idx in range(3):
        assert result[row_idx] == pytest.approx(expected[row_idx], abs=1e-12)


@pytest.mark.parametrize("mount_face", range(12))
def test_cylinder_axis_index_matches(fragment_ns: dict, mount_face: int) -> None:
    assert fragment_ns["cylinder_axis_index"](mount_face) == cylinder_axis_index(mount_face)


@pytest.mark.parametrize("axis_index", [0, 1, 2])
@pytest.mark.parametrize("radius", [3.0, 5.5, 10.0])
def test_cylinder_base_center_offset_matches(
    fragment_ns: dict, axis_index: int, radius: float
) -> None:
    expected = cylinder_base_center_offset(axis_index, radius)
    result = fragment_ns["cylinder_base_center_offset"](axis_index, radius)
    assert result == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize(
    "dims,radius,height,axis_index",
    [
        ([8.0, 20.0], None, None, 0),
        ([10.0, 20.0, 30.0], None, None, 1),
        (None, 5.0, 15.0, 2),
    ],
)
def test_infer_cylinder_radius_and_height_matches(
    fragment_ns: dict,
    dims: list[float] | None,
    radius: float | None,
    height: float | None,
    axis_index: int,
) -> None:
    # geometry.py version takes (component_id, component_dict, axis_index)
    component = {}
    if dims is not None:
        component["dims"] = dims
    if radius is not None:
        component["radius"] = radius
    if height is not None:
        component["height"] = height

    expected = infer_cylinder_radius_and_height("test", component, axis_index)
    # fragment version takes (component_id, dims, radius, height, axis_index)
    result = fragment_ns["infer_cylinder_radius_and_height"](
        "test", dims, radius, height, axis_index
    )
    assert result == pytest.approx(expected, abs=1e-12)


def test_translate_position_matches_vector_add_apply_rotation(
    fragment_ns: dict,
) -> None:
    position = [1.0, 2.0, 3.0]
    rotation = _to_float_matrix([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
    offset = [4.0, 5.0, 6.0]

    expected = vector_add(position, apply_rotation([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], offset))
    result = fragment_ns["translate_position"](position, rotation, offset)
    assert result == pytest.approx(expected, abs=1e-12)

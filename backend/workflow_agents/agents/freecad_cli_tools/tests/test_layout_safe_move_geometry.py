from __future__ import annotations

import math
from copy import deepcopy

import pytest

from freecad_cli_tools.geometry import (
    FACE_DEFINITIONS,
    IDENTITY_ROTATION,
    analyze_position,
    apply_in_plane_spin,
    apply_rotation,
    box_bounds,
    broad_phase_obstacles,
    build_analysis_context,
    centered_face_position,
    component_local_extents,
    component_mount_face,
    component_solid_placement,
    compute_mount_point,
    constrain_position_to_envelope_face,
    envelope_face,
    face_normal,
    find_best_safe_scale,
    inside_face_in_plane_bounds,
    is_external_face,
    mount_point_from_component,
    normalize_spin_quarter_turns,
    position_for_mount_point,
    rotation_for_component_contact_face,
    translate_bounds,
    update_component_placement,
)


def make_layout() -> dict:
    return {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
        },
        "components": {
            "P001": {
                "dims": [10.0, 10.0, 10.0],
                "placement": {
                    "position": [0.0, 0.0, 0.0],
                    "mount_face": 1,
                    "mount_point": [10.0, 5.0, 5.0],
                },
            },
        },
    }


def make_cylinder_layout() -> dict:
    return {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
        },
        "components": {
            "C001": {
                "shape": "cylinder",
                "dims": [8.0, 20.0],
                "placement": {
                    "position": [0.0, 0.0, 0.0],
                    "mount_face": 1,
                    "mount_point": [999.0, 999.0, 999.0],
                },
            },
        },
    }


def test_find_best_safe_scale_returns_full_move_when_unobstructed() -> None:
    data = make_layout()
    context = build_analysis_context(data, "P001", IDENTITY_ROTATION)

    scale = find_best_safe_scale(
        context=context,
        start=[0.0, 0.0, 0.0],
        move=[20.0, 0.0, 0.0],
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert scale == 1.0


def test_find_best_safe_scale_stops_at_first_collision_even_if_end_is_clear() -> None:
    data = make_layout()
    data["components"]["P999"] = {
        "dims": [10.0, 10.0, 10.0],
        "placement": {
            "position": [15.0, 0.0, 0.0],
            "mount_face": 1,
            "mount_point": [25.0, 5.0, 5.0],
        },
    }
    context = build_analysis_context(data, "P001", IDENTITY_ROTATION)

    scale = find_best_safe_scale(
        context=context,
        start=[0.0, 0.0, 0.0],
        move=[30.0, 0.0, 0.0],
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert scale is not None
    assert math.isclose(scale, 1.0 / 6.0, rel_tol=0.0, abs_tol=1e-6)


def test_find_best_safe_scale_stops_at_envelope_boundary() -> None:
    data = make_layout()
    context = build_analysis_context(data, "P001", IDENTITY_ROTATION)

    scale = find_best_safe_scale(
        context=context,
        start=[0.0, 0.0, 0.0],
        move=[60.0, 0.0, 0.0],
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert scale is not None
    assert math.isclose(scale, 2.0 / 3.0, rel_tol=0.0, abs_tol=1e-6)


def test_broad_phase_obstacles_filters_bounds_outside_swept_path() -> None:
    data = make_layout()
    data["components"]["NEAR"] = {
        "dims": [10.0, 10.0, 10.0],
        "placement": {
            "position": [18.0, 0.0, 0.0],
            "mount_face": 1,
            "mount_point": [28.0, 5.0, 5.0],
        },
    }
    data["components"]["FAR"] = {
        "dims": [10.0, 10.0, 10.0],
        "placement": {
            "position": [18.0, 80.0, 0.0],
            "mount_face": 1,
            "mount_point": [28.0, 85.0, 5.0],
        },
    }
    context = build_analysis_context(data, "P001", IDENTITY_ROTATION)
    start_bounds = box_bounds([0.0, 0.0, 0.0], [10.0, 10.0, 10.0], IDENTITY_ROTATION)

    candidates = broad_phase_obstacles(
        context=context,
        start_bounds=start_bounds,
        move=[30.0, 0.0, 0.0],
        max_scale=1.0,
    )

    assert [candidate_id for candidate_id, _ in candidates] == ["NEAR"]


def test_translate_bounds_keeps_collision_cutoff_exact() -> None:
    bounds = box_bounds([0.0, 0.0, 0.0], [10.0, 10.0, 10.0], IDENTITY_ROTATION)

    translated = translate_bounds(bounds, [5.0, -2.0, 3.0])

    assert translated == [(5.0, 15.0), (-2.0, 8.0), (3.0, 13.0)]


def test_component_local_extents_support_two_value_cylinder_dims() -> None:
    data = make_cylinder_layout()

    extents = component_local_extents("C001", data["components"]["C001"])

    assert extents == [20.0, 8.0, 8.0]


def test_find_best_safe_scale_supports_cylinder_targets() -> None:
    data = make_cylinder_layout()
    data["components"]["B001"] = {
        "dims": [10.0, 10.0, 10.0],
        "placement": {
            "position": [25.0, 0.0, 0.0],
            "mount_face": 1,
        },
    }
    context = build_analysis_context(data, "C001", IDENTITY_ROTATION)

    scale = find_best_safe_scale(
        context=context,
        start=[0.0, 0.0, 0.0],
        move=[20.0, 0.0, 0.0],
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert scale is not None
    assert math.isclose(scale, 0.25, rel_tol=0.0, abs_tol=1e-6)


def test_mount_point_from_component_recomputes_stale_cylinder_value() -> None:
    data = make_cylinder_layout()

    mount_point = mount_point_from_component("C001", data["components"]["C001"])

    assert mount_point == [20.0, 4.0, 4.0]


def test_update_component_placement_updates_dataset_fields() -> None:
    data = make_layout()
    original = deepcopy(data)

    updated = update_component_placement(
        data=data,
        component_id="P001",
        position=[12.0, 8.0, 4.0],
        component_mount_face=1,
        envelope_face_id=5,
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert data == original
    placement = updated["components"]["P001"]["placement"]
    assert placement["position"] == [12.0, 8.0, 4.0]
    assert placement["mount_face_id"] == "outer.zmax_inner"
    assert placement["component_mount_face_id"] == "P001.local_xmax"
    assert placement["mount_point"] == [22.0, 13.0, 9.0]


def test_update_component_placement_updates_cylinder_mount_point() -> None:
    data = make_cylinder_layout()
    original = deepcopy(data)

    updated = update_component_placement(
        data=data,
        component_id="C001",
        position=[2.0, 4.0, 6.0],
        component_mount_face=1,
        envelope_face_id=5,
        rotation_matrix=IDENTITY_ROTATION,
    )

    assert data == original
    placement = updated["components"]["C001"]["placement"]
    assert placement["position"] == [2.0, 4.0, 6.0]
    assert placement["mount_face_id"] == "outer.zmax_inner"
    assert placement["component_mount_face_id"] == "C001.local_xmax"
    assert placement["mount_point"] == [22.0, 8.0, 10.0]


def test_update_component_placement_preserves_external_install_face_in_new_schema() -> None:
    data = {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
            "outer_size": [110.0, 110.0, 110.0],
        },
        "components": {
            "P022": {
                "shape": "box",
                "dims": [10.0, 20.0, 30.0],
                "placement": {
                    "position": [1.0, 2.0, 3.0],
                    "mount_face": 11,
                    "mount_point": [6.0, 12.0, 3.0],
                },
            }
        },
    }
    original = deepcopy(data)

    updated = update_component_placement(
        data=data,
        component_id="P022",
        position=[21.0, 2.0, 3.0],
        install_face=11,
    )

    assert data == original
    placement = updated["components"]["P022"]["placement"]
    assert placement["position"] == [21.0, 2.0, 3.0]
    assert placement["mount_face_id"] == "outer.zmax_outer"
    assert placement["mount_point"] == [26.0, 12.0, 3.0]
    assert "mount_face" not in placement
    assert "envelope_face" not in placement
    assert "rotation_matrix" not in placement


def test_rotation_for_component_contact_face_aligns_same_face_to_new_mount_face() -> None:
    rotation = rotation_for_component_contact_face(
        component_contact_face=4,
        target_envelope_face=10,
    )

    assert rotation != IDENTITY_ROTATION
    assert apply_rotation(rotation, face_normal(4)) == face_normal(5)


def test_update_component_placement_keeps_component_contact_face_when_install_face_changes() -> (
    None
):
    data = {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
            "outer_size": [110.0, 110.0, 110.0],
        },
        "components": {
            "P022": {
                "shape": "box",
                "dims": [10.0, 20.0, 30.0],
                "placement": {
                    "position": [1.0, 2.0, 3.0],
                    "mount_face": 11,
                    "mount_point": [6.0, 12.0, 3.0],
                },
            }
        },
    }
    rotation = rotation_for_component_contact_face(
        component_contact_face=4,
        target_envelope_face=10,
    )

    updated = update_component_placement(
        data=data,
        component_id="P022",
        position=[-5.0, -10.0, -55.0],
        install_face=10,
        rotation_matrix=rotation,
    )

    placement = updated["components"]["P022"]["placement"]
    assert placement["mount_face_id"] == "outer.zmin_outer"
    assert "rotation_matrix" not in placement
    assert component_mount_face(updated["components"]["P022"]) == 4
    assert placement["mount_point"][2] == -55.0


def test_face_change_position_stays_seated_on_target_wall_for_all_faces() -> None:
    data = {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
            "outer_size": [110.0, 110.0, 110.0],
        },
        "components": {
            "P022": {
                "shape": "box",
                "dims": [10.0, 20.0, 30.0],
                "placement": {
                    "position": [55.0, -10.0, 5.0],
                    "mount_face": 7,
                    "mount_point": [55.0, 0.0, 0.0],
                    "rotation_matrix": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
                },
            }
        },
    }

    for target_face in FACE_DEFINITIONS:
        wall_size = (
            data["envelope"]["outer_size"]
            if is_external_face(target_face)
            else data["envelope"]["inner_size"]
        )
        component = data["components"]["P022"]
        component_face = component_mount_face(component)
        extents = component_local_extents("P022", component)
        base_position, _, rotation = centered_face_position(
            extents,
            wall_size,
            component_face,
            target_face,
        )
        final_position = constrain_position_to_envelope_face(
            base_position,
            extents,
            wall_size,
            target_face,
            rotation,
        )

        updated = update_component_placement(
            data,
            "P022",
            final_position,
            target_face,
            rotation_matrix=rotation,
        )
        updated_component = updated["components"]["P022"]
        placement = updated_component["placement"]
        _, axis, direction = FACE_DEFINITIONS[envelope_face(updated_component)]
        target_coordinate = -wall_size[axis] / 2.0 if direction < 0 else wall_size[axis] / 2.0

        assert component_mount_face(updated_component) == 4
        assert placement["mount_point"][axis] == target_coordinate


def test_component_solid_placement_offsets_cylinder_for_cad_sync() -> None:
    data = make_cylinder_layout()

    position, rotation = component_solid_placement(
        "C001",
        data["components"]["C001"],
        [1.0, 2.0, 3.0],
        IDENTITY_ROTATION,
    )

    assert position == [1.0, 6.0, 7.0]
    assert rotation == [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]


def test_in_plane_spin_keeps_mount_point_fixed_on_same_face() -> None:
    dims = [10.0, 20.0, 30.0]
    mount_point = [10.0, 10.0, 15.0]

    rotated = apply_in_plane_spin(
        base_rotation=IDENTITY_ROTATION,
        target_envelope_face=1,
        spin_quarter_turns=normalize_spin_quarter_turns(90),
    )
    position = position_for_mount_point(
        mount_point=mount_point,
        dims=dims,
        mount_face=1,
        rotation_matrix=rotated,
    )

    assert rotated == [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
    assert position == [0.0, 25.0, 5.0]
    assert compute_mount_point(position, dims, 1, rotated) == mount_point


def test_normalize_spin_quarter_turns_rejects_non_right_angle_input() -> None:
    with pytest.raises(ValueError, match="multiple of 90"):
        normalize_spin_quarter_turns(45)


# ---------------------------------------------------------------------------
# In-plane face boundary constraint tests
# ---------------------------------------------------------------------------


def make_external_layout() -> dict:
    """Layout with outer_size for external face tests.

    Envelope inner_size 100×100×100, outer_size 110×110×110.
    Component P001 is a 10×10×10 box mounted on external +X face (face 7),
    centered at origin in the YZ plane.  Position is set so the contact face
    sits flush against the outer wall at x = 55 (outer_size[0]/2).
    """
    return {
        "envelope": {
            "inner_size": [100.0, 100.0, 100.0],
            "outer_size": [110.0, 110.0, 110.0],
        },
        "components": {
            "P001": {
                "shape": "box",
                "dims": [10.0, 10.0, 10.0],
                "placement": {
                    # x-min at 55 → component extends outward from x=55 to x=65
                    "position": [55.0, -5.0, -5.0],
                    "mount_face": 7,
                    "envelope_face": 7,
                    "rotation_matrix": IDENTITY_ROTATION,
                    "mount_point": [55.0, 0.0, 0.0],
                },
            },
        },
    }


def make_external_context(data: dict) -> dict:
    outer_size = data["envelope"]["outer_size"]
    return build_analysis_context(
        data,
        "P001",
        IDENTITY_ROTATION,
        check_envelope=False,
        envelope_face_id=7,
        wall_size=outer_size,
    )


def test_inside_face_in_plane_bounds_accepts_centered_component() -> None:
    # 10×10 box centered at YZ origin on the +X face of a 110×110×110 outer envelope
    bounds = box_bounds([55.0, -5.0, -5.0], [10.0, 10.0, 10.0], IDENTITY_ROTATION)
    assert inside_face_in_plane_bounds(bounds, [110.0, 110.0, 110.0], face_id=7)


def test_inside_face_in_plane_bounds_rejects_out_of_bounds_component() -> None:
    # Move the component so its Z-max (5 + 60 = 65) exceeds outer_size[2]/2 = 55
    bounds = box_bounds([55.0, -5.0, 55.0], [10.0, 10.0, 10.0], IDENTITY_ROTATION)
    assert not inside_face_in_plane_bounds(bounds, [110.0, 110.0, 110.0], face_id=7)


def test_external_face_move_blocked_at_face_boundary() -> None:
    data = make_external_layout()
    context = make_external_context(data)
    # Requested position puts the component's Z-max at 5 + 60 = 65 > 55 → FACE_BOUNDARY
    ok, blockers = analyze_position(context, [55.0, -5.0, 50.0], IDENTITY_ROTATION)
    assert not ok
    assert "FACE_BOUNDARY" in blockers


def test_external_face_move_allowed_within_face_boundary() -> None:
    data = make_external_layout()
    context = make_external_context(data)
    # Move within the face: Z-max = 5 + 40 = 45 < 55 → ok
    ok, blockers = analyze_position(context, [55.0, -5.0, 40.0], IDENTITY_ROTATION)
    assert ok
    assert blockers == []


def test_external_face_scale_search_stops_at_face_boundary() -> None:
    data = make_external_layout()
    context = make_external_context(data)
    # Start centered at origin in YZ; move 60 units along +Z would exit the face
    start = [55.0, -5.0, -5.0]
    move = [0.0, 0.0, 60.0]
    scale = find_best_safe_scale(context, start, move, IDENTITY_ROTATION)
    assert scale is not None
    # At scale 1.0 the component Z-max would be 65 > 55; scale must be < 1.0
    assert scale < 1.0
    # At the returned scale the component must still be within the face boundary
    final_z = -5.0 + 60.0 * scale
    final_bounds = box_bounds([55.0, -5.0, final_z], [10.0, 10.0, 10.0], IDENTITY_ROTATION)
    assert inside_face_in_plane_bounds(final_bounds, [110.0, 110.0, 110.0], face_id=7)


def test_internal_face_envelope_boundary_still_enforced() -> None:
    data = make_layout()
    context = build_analysis_context(
        data,
        "P001",
        IDENTITY_ROTATION,
        check_envelope=True,
        envelope_face_id=1,
        wall_size=data["envelope"]["inner_size"],
    )
    # Move out of the inner envelope → ENVELOPE_BOUNDARY (not FACE_BOUNDARY)
    ok, blockers = analyze_position(context, [100.0, 0.0, 0.0], IDENTITY_ROTATION)
    assert not ok
    assert "ENVELOPE_BOUNDARY" in blockers
    assert "FACE_BOUNDARY" not in blockers

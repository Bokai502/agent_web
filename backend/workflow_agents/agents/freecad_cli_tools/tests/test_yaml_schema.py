from __future__ import annotations

import pytest

from freecad_cli_tools.yaml_schema import AssemblyValidationError, validate_assembly


def _minimal_assembly(**overrides: object) -> dict:
    data = {
        "envelope": {"inner_size": [100.0, 100.0, 100.0]},
        "components": {
            "P001": {
                "dims": [10.0, 10.0, 10.0],
                "placement": {
                    "position": [0.0, 0.0, 0.0],
                    "mount_face": 1,
                },
            },
        },
    }
    data.update(overrides)
    return data


def _minimal_cylinder_assembly() -> dict:
    return {
        "envelope": {"inner_size": [100.0, 100.0, 100.0]},
        "components": {
            "C001": {
                "shape": "cylinder",
                "dims": [8.0, 20.0],
                "placement": {
                    "position": [0.0, 0.0, 0.0],
                    "mount_face": 1,
                },
            },
        },
    }


def test_valid_box_assembly_passes() -> None:
    validate_assembly(_minimal_assembly())


def test_valid_cylinder_assembly_passes() -> None:
    validate_assembly(_minimal_cylinder_assembly())


def test_missing_envelope_raises() -> None:
    data = _minimal_assembly()
    del data["envelope"]
    with pytest.raises(AssemblyValidationError, match="envelope"):
        validate_assembly(data)


def test_missing_inner_size_raises() -> None:
    data = _minimal_assembly()
    del data["envelope"]["inner_size"]
    with pytest.raises(AssemblyValidationError, match="inner_size"):
        validate_assembly(data)


def test_missing_components_raises() -> None:
    data = _minimal_assembly()
    del data["components"]
    with pytest.raises(AssemblyValidationError, match="components"):
        validate_assembly(data)


def test_empty_components_raises() -> None:
    data = _minimal_assembly(components={})
    with pytest.raises(AssemblyValidationError, match="non-empty"):
        validate_assembly(data)


def test_missing_position_raises() -> None:
    data = _minimal_assembly()
    del data["components"]["P001"]["placement"]["position"]
    with pytest.raises(AssemblyValidationError, match="position"):
        validate_assembly(data)


def test_box_missing_dims_raises() -> None:
    data = _minimal_assembly()
    del data["components"]["P001"]["dims"]
    with pytest.raises(AssemblyValidationError, match="dims"):
        validate_assembly(data)


def test_box_wrong_dims_count_raises() -> None:
    data = _minimal_assembly()
    data["components"]["P001"]["dims"] = [10.0, 10.0]
    with pytest.raises(AssemblyValidationError, match="exactly 3"):
        validate_assembly(data)


def test_cylinder_missing_size_info_raises() -> None:
    data = _minimal_cylinder_assembly()
    del data["components"]["C001"]["dims"]
    with pytest.raises(AssemblyValidationError, match="radius.*height.*dims"):
        validate_assembly(data)


def test_invalid_mount_face_raises() -> None:
    data = _minimal_assembly()
    data["components"]["P001"]["placement"]["mount_face"] = 13
    with pytest.raises(AssemblyValidationError, match="mount_face"):
        validate_assembly(data)


def test_invalid_rotation_matrix_raises() -> None:
    data = _minimal_assembly()
    data["components"]["P001"]["placement"]["rotation_matrix"] = [[1, 0], [0, 1]]
    with pytest.raises(AssemblyValidationError, match="rotation_matrix"):
        validate_assembly(data)


def test_error_messages_include_component_id() -> None:
    data = _minimal_assembly()
    del data["components"]["P001"]["placement"]["position"]
    with pytest.raises(AssemblyValidationError, match="P001"):
        validate_assembly(data)


def test_non_dict_data_raises() -> None:
    with pytest.raises(AssemblyValidationError, match="mapping"):
        validate_assembly("not a dict")


def test_cylinder_with_explicit_radius_height_passes() -> None:
    data = {
        "envelope": {"inner_size": [100.0, 100.0, 100.0]},
        "components": {
            "C001": {
                "shape": "cylinder",
                "radius": 5.0,
                "height": 20.0,
                "placement": {
                    "position": [0.0, 0.0, 0.0],
                    "mount_face": 4,
                },
            },
        },
    }
    validate_assembly(data)

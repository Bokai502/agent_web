"""YAML assembly schema validation.

Provides validate_assembly() which checks a parsed YAML dict against
the expected component/envelope schema and raises AssemblyValidationError
with a descriptive message for any structural problems.
"""

from __future__ import annotations

from typing import Any

_VALID_FACE_IDS = frozenset(range(12))
_VALID_SHAPES = frozenset(("box", "cylinder"))
_VALID_AXES = frozenset(("x", "y", "z"))
_VALID_FLANGE_SIGNS = frozenset((-1, 1))


class AssemblyValidationError(ValueError):
    """Raised when a YAML assembly fails schema validation."""


def validate_assembly(data: Any) -> None:
    """Validate a parsed YAML assembly dict.

    Raises AssemblyValidationError with a descriptive message if the
    data does not conform to the expected schema.
    """
    if not isinstance(data, dict):
        raise AssemblyValidationError(
            f"Assembly data must be a mapping (got {type(data).__name__})."
        )
    _validate_envelope(data)
    _validate_components(data)


def _validate_envelope(data: dict) -> None:
    if "envelope" not in data:
        raise AssemblyValidationError("Missing required key 'envelope'.")
    envelope = data["envelope"]
    if not isinstance(envelope, dict):
        raise AssemblyValidationError(
            f"'envelope' must be a mapping (got {type(envelope).__name__})."
        )
    if "inner_size" not in envelope:
        raise AssemblyValidationError("Envelope: missing required field 'inner_size'.")
    inner_size = envelope["inner_size"]
    if not isinstance(inner_size, list) or len(inner_size) != 3:
        raise AssemblyValidationError(
            f"Envelope: 'inner_size' must be a list of 3 numbers (got {inner_size!r})."
        )
    if not all(isinstance(v, (int, float)) and v > 0 for v in inner_size):
        raise AssemblyValidationError(
            f"Envelope: 'inner_size' values must be positive numbers (got {inner_size!r})."
        )
    ef = envelope.get("envelope_face")
    if ef is not None and ef not in _VALID_FACE_IDS:
        raise AssemblyValidationError(
            f"Envelope: 'envelope_face' must be an integer in 0..11 (got {ef!r})."
        )


def _validate_components(data: dict) -> None:
    if "components" not in data:
        raise AssemblyValidationError("Missing required key 'components'.")
    components = data["components"]
    if not isinstance(components, dict) or len(components) == 0:
        raise AssemblyValidationError("'components' must be a non-empty mapping.")
    for comp_id, comp in components.items():
        _validate_single_component(str(comp_id), comp)


def _validate_single_component(comp_id: str, comp: Any) -> None:
    if not isinstance(comp, dict):
        raise AssemblyValidationError(
            f"Component '{comp_id}': must be a mapping (got {type(comp).__name__})."
        )
    shape = str(comp.get("shape", "box")).strip().lower()
    if shape not in _VALID_SHAPES:
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'shape' must be 'box' or 'cylinder' (got {shape!r})."
        )
    _validate_placement(comp_id, comp.get("placement"))
    _validate_dims(comp_id, comp, shape)
    _validate_replacement(comp_id, comp.get("replacement"))


def _validate_replacement(comp_id: str, replacement: Any) -> None:
    if replacement is None:
        return
    if not isinstance(replacement, dict):
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'replacement' must be a mapping (got "
            f"{type(replacement).__name__})."
        )
    step_file = replacement.get("step_file")
    if step_file is not None and not isinstance(step_file, str):
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'replacement.step_file' must be a string "
            f"(got {step_file!r})."
        )
    thrust_axis = replacement.get("thrust_axis")
    if thrust_axis is not None:
        if not isinstance(thrust_axis, str) or thrust_axis.lower() not in _VALID_AXES:
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'replacement.thrust_axis' must be one of "
                f"'x'/'y'/'z' (got {thrust_axis!r})."
            )
    flange_sign = replacement.get("flange_sign")
    if flange_sign is not None:
        if flange_sign not in _VALID_FLANGE_SIGNS:
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'replacement.flange_sign' must be +1 or -1 "
                f"(got {flange_sign!r})."
            )


def _validate_placement(comp_id: str, placement: Any) -> None:
    if placement is None or not isinstance(placement, dict):
        raise AssemblyValidationError(f"Component '{comp_id}': missing required field 'placement'.")
    if "position" not in placement:
        raise AssemblyValidationError(
            f"Component '{comp_id}': missing required field 'placement.position'."
        )
    pos = placement["position"]
    if not isinstance(pos, list) or len(pos) != 3:
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'placement.position' must be a list of 3 numbers "
            f"(got {pos!r})."
        )
    if not all(isinstance(v, (int, float)) for v in pos):
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'placement.position' values must be numbers (got {pos!r})."
        )
    mf = placement.get("mount_face")
    if mf is not None and mf not in _VALID_FACE_IDS:
        raise AssemblyValidationError(
            f"Component '{comp_id}': 'mount_face' must be an integer in 0..11 (got {mf!r})."
        )
    mp = placement.get("mount_point")
    if mp is not None:
        if (
            not isinstance(mp, list)
            or len(mp) != 3
            or not all(isinstance(v, (int, float)) for v in mp)
        ):
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'mount_point' must be a list of 3 numbers (got {mp!r})."
            )
    rotation_matrix = placement.get("rotation_matrix")
    if rotation_matrix is not None:
        if (
            not isinstance(rotation_matrix, list)
            or len(rotation_matrix) != 3
            or not all(
                isinstance(row, list)
                and len(row) == 3
                and all(isinstance(value, (int, float)) for value in row)
                for row in rotation_matrix
            )
        ):
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'rotation_matrix' must be a 3x3 numeric matrix "
                f"(got {rotation_matrix!r})."
            )


def _validate_dims(comp_id: str, comp: dict, shape: str) -> None:
    dims = comp.get("dims")
    if shape == "box":
        if dims is None or not isinstance(dims, list) or len(dims) != 3:
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'dims' must contain exactly 3 values for a box shape"
                f" (got {dims!r})."
            )
        if not all(isinstance(v, (int, float)) and v > 0 for v in dims):
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'dims' values must be positive numbers (got {dims!r})."
            )
    elif shape == "cylinder":
        radius = comp.get("radius")
        height = comp.get("height")
        has_explicit = radius is not None and height is not None
        has_dims = dims is not None
        if not has_explicit and not has_dims:
            raise AssemblyValidationError(
                f"Component '{comp_id}': cylinder requires either ('radius' + 'height') or 'dims'."
            )
        if has_dims:
            if not isinstance(dims, list) or len(dims) not in (2, 3):
                raise AssemblyValidationError(
                    f"Component '{comp_id}': cylinder 'dims' must have 2 or 3 values"
                    f" (got {dims!r})."
                )
            if not all(isinstance(v, (int, float)) and v > 0 for v in dims):
                raise AssemblyValidationError(
                    f"Component '{comp_id}': 'dims' values must be positive numbers"
                    f" (got {dims!r})."
                )
        if radius is not None and (not isinstance(radius, (int, float)) or radius <= 0):
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'radius' must be a positive number (got {radius!r})."
            )
        if height is not None and (not isinstance(height, (int, float)) or height <= 0):
            raise AssemblyValidationError(
                f"Component '{comp_id}': 'height' must be a positive number (got {height!r})."
            )

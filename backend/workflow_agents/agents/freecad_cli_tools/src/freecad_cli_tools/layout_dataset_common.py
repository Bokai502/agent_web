"""Shared validation helpers for layout dataset normalization and write-back."""

from __future__ import annotations

from typing import Any


class LayoutDatasetError(ValueError):
    """Raised when a layout dataset pair cannot be normalized."""


FACE_TOKEN_TO_ID = {
    "xmin": 0,
    "xmax": 1,
    "ymin": 2,
    "ymax": 3,
    "zmin": 4,
    "zmax": 5,
}
FACE_ID_TO_TOKEN = {value: key for key, value in FACE_TOKEN_TO_ID.items()}


def require_face_id(
    value: Any,
    field_name: str,
    *,
    allow_external: bool,
) -> int:
    if not isinstance(value, (int, float)):
        raise LayoutDatasetError(f"{field_name} must be a numeric face id.")
    face_id = int(value)
    upper_bound = 11 if allow_external else 5
    if face_id < 0 or face_id > upper_bound:
        raise LayoutDatasetError(
            f"{field_name} must be between 0 and {upper_bound} (got {value!r})."
        )
    return face_id


def require_axis_index(value: Any, field_name: str) -> int:
    if not isinstance(value, (int, float)):
        raise LayoutDatasetError(f"{field_name} must be a numeric axis index.")
    axis_index = int(value)
    if axis_index < 0 or axis_index > 2:
        raise LayoutDatasetError(f"{field_name} must be between 0 and 2 (got {value!r}).")
    return axis_index


def require_number(value: Any, field_name: str) -> float:
    if not isinstance(value, (int, float)):
        raise LayoutDatasetError(f"{field_name} must be numeric (got {value!r}).")
    return float(value)


def require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LayoutDatasetError(f"{field_name} must be a non-empty string.")
    return value


def vector3(values: Any, field_name: str) -> list[float]:
    if not isinstance(values, list) or len(values) != 3:
        raise LayoutDatasetError(f"{field_name} must be a 3-value array.")
    return [require_number(value, field_name) for value in values]


def bbox_size(bbox: Any, field_name: str) -> list[float]:
    if not isinstance(bbox, dict):
        raise LayoutDatasetError(f"{field_name} must be a JSON object.")
    bbox_min = vector3(bbox.get("min"), f"{field_name}.min")
    bbox_max = vector3(bbox.get("max"), f"{field_name}.max")
    return [bbox_max[index] - bbox_min[index] for index in range(3)]


def face_token_after_dot(face_id: str, field_name: str) -> str:
    if not isinstance(face_id, str) or "." not in face_id:
        raise LayoutDatasetError(f"{field_name} must contain an owner-qualified face id.")
    return face_id.split(".", 1)[1]


def face_token_to_id(face_token: str, source: str) -> int:
    if face_token not in FACE_TOKEN_TO_ID:
        raise LayoutDatasetError(f"Unsupported face token in {source!r}: {face_token!r}")
    return FACE_TOKEN_TO_ID[face_token]

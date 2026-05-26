"""Face-id parsing and reverse-mapping helpers for layout datasets."""

from __future__ import annotations

from typing import Any

from freecad_cli_tools.geometry import is_external_face
from freecad_cli_tools.layout_dataset_common import (
    FACE_ID_TO_TOKEN,
    FACE_TOKEN_TO_ID,
    LayoutDatasetError,
    face_token_after_dot,
    face_token_to_id,
    require_axis_index,
    require_face_id,
    require_string,
)


def layout_mount_face_to_face_id(face_id: str) -> int:
    """Map dataset mount-face ids to the existing 0..11 envelope face ids."""
    token = face_token_after_dot(face_id, "mount_face_id")
    if token in FACE_TOKEN_TO_ID:
        return FACE_TOKEN_TO_ID[token]
    if token.endswith("_inner"):
        return face_token_to_id(token[: -len("_inner")], face_id)
    if token.endswith("_outer"):
        return face_token_to_id(token[: -len("_outer")], face_id) + 6
    raise LayoutDatasetError(f"Unsupported mount_face_id: {face_id!r}")


def component_local_face_to_face_id(face_id: str) -> int:
    """Parse component local-face ids like 'P000.local_ymax' into 0..5 ids."""
    token = face_token_after_dot(face_id, "component_mount_face_id")
    if not token.startswith("local_"):
        raise LayoutDatasetError(f"Unsupported component_mount_face_id: {face_id!r}")
    return face_token_to_id(token[len("local_") :], face_id)


def face_id_to_layout_mount_face_id(face_id: int, *, owner_id: str | None = None) -> str:
    """Map an internal 0..11 face id back to a dataset mount_face_id string."""
    require_face_id(face_id, "face_id", allow_external=True)
    token = FACE_ID_TO_TOKEN[face_id % 6]
    if is_external_face(face_id):
        return f"outer.{token}_outer"

    resolved_owner = (owner_id or "outer").strip()
    if resolved_owner == "outer":
        return f"outer.{token}_inner"
    return f"{resolved_owner}.{token}"


def component_face_id_to_layout_face_id(component_id: str, face_id: int) -> str:
    """Build a dataset component-local face id like 'P000.local_ymax'."""
    require_face_id(face_id, "component_face_id", allow_external=False)
    return f"{component_id}.local_{FACE_ID_TO_TOKEN[face_id]}"


def resolve_layout_mount_face_id(
    layout_topology: dict[str, Any],
    install_face_id: int,
    *,
    current_placement: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Resolve a numeric install face into a concrete layout_topology face id."""
    require_face_id(install_face_id, "install_face_id", allow_external=True)
    candidates = _layout_install_face_candidates(layout_topology, install_face_id)
    if not candidates:
        raise LayoutDatasetError(
            f"layout_topology.install_faces has no face for install_face_id={install_face_id}."
        )

    if is_external_face(install_face_id):
        outer_candidates = [face for face in candidates if _layout_face_owner_key(face) == "outer"]
        if len(outer_candidates) == 1:
            return outer_candidates[0]["id"], "outer"
        if len(candidates) == 1:
            chosen = candidates[0]
            return chosen["id"], _layout_face_owner_key(chosen)
        raise LayoutDatasetError(
            "Ambiguous external install face resolution for "
            f"install_face_id={install_face_id}: "
            f"{[face['id'] for face in candidates]}"
        )

    preferred_owner = _preferred_layout_owner_key(current_placement)
    if preferred_owner is not None:
        owner_matches = [
            face for face in candidates if _layout_face_owner_key(face) == preferred_owner
        ]
        if len(owner_matches) == 1:
            return owner_matches[0]["id"], preferred_owner
        if len(owner_matches) > 1:
            raise LayoutDatasetError(
                "Multiple install_faces matched the same preferred owner "
                f"{preferred_owner!r}: {[face['id'] for face in owner_matches]}"
            )

    internal_candidates = [face for face in candidates if _layout_face_owner_key(face) != "outer"]
    if len(internal_candidates) == 1:
        chosen = internal_candidates[0]
        return chosen["id"], _layout_face_owner_key(chosen)

    if len(candidates) == 1:
        chosen = candidates[0]
        return chosen["id"], _layout_face_owner_key(chosen)

    raise LayoutDatasetError(
        "Ambiguous internal install face resolution for "
        f"install_face_id={install_face_id}: {[face['id'] for face in candidates]}"
    )


def resolve_geom_install_face(geom: dict[str, Any], mount_face_id: str) -> dict[str, Any]:
    """Resolve a concrete mount_face_id to the corresponding geom.install_faces entry."""
    install_faces = geom.get("install_faces")
    if not isinstance(install_faces, dict):
        raise LayoutDatasetError("geom.install_faces must be a JSON object.")
    face = install_faces.get(mount_face_id)
    if not isinstance(face, dict):
        raise LayoutDatasetError(f"geom.install_faces[{mount_face_id!r}] is missing.")
    return face


def dataset_mount_point_from_face(
    mount_point: list[float],
    install_face: dict[str, Any],
    clearance: float,
) -> list[float]:
    """Rebuild the dataset's stored mount_point convention."""
    stored_mount_point = [float(value) for value in mount_point]
    normal_axis = require_axis_index(
        install_face.get("plane_axis"),
        "install_face.plane_axis",
    )
    for axis in range(3):
        if axis != normal_axis:
            stored_mount_point[axis] -= clearance
    return stored_mount_point


def dataset_install_pos_from_face(
    bbox_min: list[float],
    install_face: dict[str, Any],
    clearance: float,
) -> list[float]:
    """Rebuild the dataset's stored install_pos convention."""
    install_pos = [float(value) for value in bbox_min]
    normal_axis = require_axis_index(
        install_face.get("plane_axis"),
        "install_face.plane_axis",
    )
    side = require_string(install_face.get("side"), "install_face.side")
    for axis in range(3):
        if axis != normal_axis:
            install_pos[axis] -= clearance
    if side == "inner":
        install_pos[normal_axis] -= clearance / 2.0
    elif side != "outer":
        raise LayoutDatasetError(f"install_face.side must be 'inner' or 'outer' (got {side!r}).")
    return install_pos


def _layout_install_face_candidates(
    layout_topology: dict[str, Any],
    install_face_id: int,
) -> list[dict[str, Any]]:
    install_faces = layout_topology.get("install_faces")
    if not isinstance(install_faces, list) or not install_faces:
        raise LayoutDatasetError("layout_topology.install_faces must be a non-empty array.")

    candidates: list[dict[str, Any]] = []
    for face in install_faces:
        if not isinstance(face, dict):
            raise LayoutDatasetError("Each install_face must be a JSON object.")
        face_id = require_string(face.get("id"), "install_face.id")
        if layout_mount_face_to_face_id(face_id) == install_face_id:
            candidates.append(face)
    return candidates


def _preferred_layout_owner_key(current_placement: dict[str, Any] | None) -> str | None:
    if not isinstance(current_placement, dict):
        return None

    cabin_id = current_placement.get("cabin_id")
    if isinstance(cabin_id, str) and cabin_id.strip():
        return cabin_id

    mount_face_id = current_placement.get("mount_face_id")
    if isinstance(mount_face_id, str):
        face_token = face_token_after_dot(mount_face_id, "placement.mount_face_id")
        if face_token.endswith("_outer"):
            return None
    return _owner_id_from_face_id(mount_face_id)


def _layout_face_owner_key(face: dict[str, Any]) -> str:
    face_id = require_string(face.get("id"), "install_face.id")
    owner_key = _owner_id_from_face_id(face_id)
    if owner_key is None:
        raise LayoutDatasetError(f"Unsupported install_face id: {face_id!r}")
    return owner_key


def _owner_id_from_face_id(face_id: Any) -> str | None:
    if not isinstance(face_id, str) or "." not in face_id:
        return None
    return face_id.split(".", 1)[0]

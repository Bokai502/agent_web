from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json


KIND_TO_PIPELINE_KIND = {
    "radiator": "radiator",
    "solar_panel": "external",
    "antenna": "external",
    "camera": "external",
    "star_tracker": "external",
    "sun_sensor": "external",
    "gps_receiver": "external",
    "thruster": "external",
    "cover": "external",
    "mli": "external",
    "battery": "internal",
    "eps": "internal",
    "obc": "internal",
    "transceiver": "internal",
    "rf_switch": "internal",
    "payload_processor": "internal",
    "reaction_wheel": "internal",
    "magnetorquer": "internal",
    "magnetometer": "internal",
    "gyro": "internal",
    "heater": "internal",
    "temperature_sensor": "internal",
    "thermal_link": "internal",
    "heat_pipe": "internal",
}


def adapt_module_db_bom(
    bom: Mapping[str, Any],
    *,
    kind_map: Mapping[str, str] | None = None,
    default_mass_kg: float = 0.0,
    default_power_w: float = 0.0,
) -> dict[str, Any]:
    """Convert module_db BOM kind labels into pipeline kind labels.

    The original fine-grained kind is preserved on each item as
    ``component_subtype`` and ``source_ref.original_kind``.
    """
    mapping = dict(kind_map or KIND_TO_PIPELINE_KIND)
    adapted = deepcopy(dict(bom))
    unknown_kinds: set[str] = set()

    source = dict(adapted.get("source") or {})
    source.setdefault("type", "module_db")
    source["adapter"] = "module_db_bom_adapter"
    source["kind_mapping"] = "module_db_subtype_to_pipeline_kind"
    adapted["source"] = source

    for item in adapted.get("items", []):
        if not isinstance(item, dict):
            continue

        source_ref = dict(item.get("source_ref") or {})
        current_component_id = str(item.get("component_id") or "").strip()
        source_component_id = str(source_ref.get("slot_component_id") or item.get("component_id") or "").strip()
        excel_component_id = str(
            source_ref.get("excel_component_id")
            or source_ref.get("thermal_db_component_id")
            or item.get("semantic_name")
            or item.get("component_id")
            or ""
        ).strip()
        original_semantic_name = str(item.get("semantic_name") or "").strip()
        original_kind = str(item.get("kind", "")).strip()
        pipeline_kind = mapping.get(original_kind)
        if pipeline_kind is None:
            unknown_kinds.add(original_kind or "<empty>")
            continue

        if source_component_id:
            item["component_id"] = source_component_id
            source_ref["source_component_id"] = source_component_id
            if current_component_id and current_component_id != source_component_id:
                _rewrite_mounting_component_id(item, current_component_id, source_component_id)
        if excel_component_id:
            item["semantic_name"] = excel_component_id
            source_ref["excel_component_id"] = excel_component_id
            source_ref["thermal_db_component_id"] = excel_component_id
        if original_semantic_name and original_semantic_name != excel_component_id:
            source_ref["original_semantic_name"] = original_semantic_name
        source_ref["original_kind"] = original_kind
        item["source_ref"] = source_ref
        item["component_subtype"] = original_kind
        item["kind"] = pipeline_kind

        defaulted_fields = list(source_ref.get("module_db_adapter_defaulted_fields") or [])
        if item.get("mass_kg") is None:
            item["mass_kg"] = float(default_mass_kg)
            defaulted_fields.append("mass_kg")
        if item.get("power_W") is None:
            item["power_W"] = float(default_power_w)
            defaulted_fields.append("power_W")
        if defaulted_fields:
            source_ref["module_db_adapter_defaulted_fields"] = sorted(set(defaulted_fields))
            item["source_ref"] = source_ref

    if unknown_kinds:
        raise ValueError(f"Unknown module_db kind(s): {sorted(unknown_kinds)}")
    return adapted


def _rewrite_mounting_component_id(item: dict[str, Any], old_id: str, new_id: str) -> None:
    mounting = item.get("mounting")
    if not isinstance(mounting, dict):
        return
    old_prefix = f"{old_id}.local_"
    new_prefix = f"{new_id}.local_"
    value = mounting.get("default_component_mount_face_id")
    if isinstance(value, str) and value.startswith(old_prefix):
        mounting["default_component_mount_face_id"] = new_prefix + value[len(old_prefix) :]
    for face in mounting.get("mount_faces") or []:
        if not isinstance(face, dict):
            continue
        face_id = face.get("component_mount_face_id")
        if isinstance(face_id, str) and face_id.startswith(old_prefix):
            face["component_mount_face_id"] = new_prefix + face_id[len(old_prefix) :]


def adapt_module_db_bom_file(input_path: Path | str, output_path: Path | str) -> Path:
    adapted = adapt_module_db_bom(read_json(input_path))
    return write_json(output_path, adapted)


def adapt_module_db_bom_dir(input_dir: Path | str, output_dir: Path | str) -> list[Path]:
    input_root = Path(input_dir)
    output_root = Path(output_dir)
    output_paths: list[Path] = []
    for input_path in sorted(input_root.glob("*.json")):
        output_path = output_root / input_path.name
        output_paths.append(adapt_module_db_bom_file(input_path, output_path))
    return output_paths

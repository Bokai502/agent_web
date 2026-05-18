from __future__ import annotations

from typing import Any


KIND_PREFIX = {"internal": "P", "external": "E", "radiator": "R"}


def parts_from_components(
    components_doc: dict[str, Any],
    *,
    runtime: dict[str, Any],
    clearance_mm: float,
) -> dict[str, Any]:
    PartV2 = runtime["PartV2"]
    category_colors = runtime["CATEGORY_COLORS"]
    kind_tints = runtime["KIND_TINTS"]
    counters = {"internal": 0, "external": 0, "radiator": 0}
    parts = []
    part_source_map: dict[str, Any] = {}

    for component in components_doc["components"]:
        kind = str(component["kind"])
        part_id = _next_layout_part_id(kind, counters)
        thermal_db_component_id = thermal_db_component_id_for(component)
        category = str(component.get("category") or "payload")
        color = kind_tints.get(kind) or category_colors.get(category, category_colors["default"])
        thermal_surface = _thermal_surface(component, kind=kind)
        thermal_interface = _thermal_interface(component)

        parts.append(
            PartV2(
                id=part_id,
                kind=kind,
                category=category,
                dims=tuple(float(value) for value in component["size_mm"]),
                mass=float(component["mass_kg"]),
                power=float(component["power_W"]),
                color=color,
                clearance_mm=clearance_mm,
                model=thermal_db_component_id,
                thermal_surface=thermal_surface,
                thermal_interface=thermal_interface,
            )
        )
        source_ref = component.get("source_ref", {})
        part_source_map[part_id] = {
            "thermal_db_component_id": thermal_db_component_id,
            "instance_id": component.get("instance_id", component["component_id"]),
            "semantic_name": component.get("semantic_name"),
            "component_subtype": component.get("component_subtype"),
            "source_ref": source_ref,
        }

    return {"parts": parts, "part_source_map": part_source_map}


def estimate_outer_size_mm(
    components_doc: dict[str, Any],
    *,
    clearance_mm: float,
    target_fill_ratio: float,
) -> list[float]:
    target_fill_ratio = min(max(float(target_fill_ratio), 0.25), 0.75)
    shell_and_service_margin = max(18.0, 2.0 * float(clearance_mm) + 10.0)
    min_outer_dims = [220.0, 180.0, 140.0]
    external_surface_utilization = 0.55
    internal_volume = 0.0
    external_footprint_area = 0.0
    max_sorted_internal_dims = [0.0, 0.0, 0.0]
    for component in components_doc["components"]:
        dims = sorted((float(value) for value in component["size_mm"]), reverse=True)
        if component["kind"] == "internal":
            internal_volume += dims[0] * dims[1] * dims[2]
            for index, value in enumerate(dims):
                max_sorted_internal_dims[index] = max(max_sorted_internal_dims[index], value)
        else:
            external_footprint_area += dims[0] * dims[1]

    if internal_volume <= 0.0:
        return [300.0, 220.0, 180.0]

    base_dims = [
        max(min_outer_dims[index], max_sorted_internal_dims[index] + shell_and_service_margin)
        for index in range(3)
    ]
    target_outer_volume = internal_volume / target_fill_ratio
    long_dim = base_dims[0]
    medium_to_short_ratio = (
        base_dims[1] / base_dims[2] if base_dims[1] > 0.0 and base_dims[2] > 0.0 else 1.0
    )
    required_short = (target_outer_volume / (long_dim * medium_to_short_ratio)) ** 0.5
    dims = [
        long_dim,
        max(base_dims[1], required_short * medium_to_short_ratio),
        max(base_dims[2], required_short),
    ]

    current_volume = dims[0] * dims[1] * dims[2]
    if current_volume < target_outer_volume:
        planar_scale = (target_outer_volume / current_volume) ** 0.5
        dims[1] *= planar_scale
        dims[2] *= planar_scale

    if external_footprint_area > 0.0:
        target_surface_area = external_footprint_area / external_surface_utilization
        surface_area = 2.0 * (dims[0] * dims[1] + dims[0] * dims[2] + dims[1] * dims[2])
        if surface_area < target_surface_area:
            surface_scale = (target_surface_area / surface_area) ** 0.5
            dims = [value * surface_scale for value in dims]

    return [round(value, 6) for value in dims]


def thermal_db_component_id_for(component: dict[str, Any]) -> str:
    source_ref = component.get("source_ref") if isinstance(component.get("source_ref"), dict) else {}
    return str(
        source_ref.get("thermal_db_component_id")
        or source_ref.get("excel_component_id")
        or component.get("semantic_name")
        or component.get("component_id")
    )


def _next_layout_part_id(kind: str, counters: dict[str, int]) -> str:
    prefix = KIND_PREFIX[kind]
    index = counters[kind]
    counters[kind] += 1
    return f"{prefix}_{index:03d}_{kind}"


def _thermal_surface(component: dict[str, Any], *, kind: str) -> dict[str, Any]:
    thermal_surface = dict(component.get("thermal_surface") or {})
    thermal_surface.setdefault("emissivity", 0.85 if kind == "radiator" else 0.8)
    thermal_surface.setdefault("absorptivity", 0.3)
    return thermal_surface


def _thermal_interface(component: dict[str, Any]) -> dict[str, Any]:
    thermal_interface = dict(component.get("thermal_interface") or {})
    thermal_interface.setdefault("contact_resistance", 0.001)
    return thermal_interface

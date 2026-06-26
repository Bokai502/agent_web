from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

from ..common import get_nested, safe_float


def summarize_manifest(manifest: Any) -> dict[str, Any]:
    stages = manifest.get("stages", []) if isinstance(manifest, dict) else []
    failed = [s for s in stages if s.get("status") == "failed"]
    completed = [s for s in stages if s.get("status") == "completed"]
    return {
        "ok": manifest.get("ok") if isinstance(manifest, dict) else None,
        "stage_count": len(stages),
        "completed": [s.get("stage_name") for s in completed],
        "failed": [s.get("stage_name") for s in failed],
        "errors": [err for stage in failed for err in stage.get("errors", [])],
        "stages": stages,
    }


def bbox_dims(bbox: Any) -> list[float] | None:
    if not isinstance(bbox, dict):
        return None
    mins = bbox.get("min")
    maxs = bbox.get("max")
    if not isinstance(mins, list) or not isinstance(maxs, list) or len(mins) != 3 or len(maxs) != 3:
        return None
    return [safe_float(maxs[i]) - safe_float(mins[i]) for i in range(3)]


def bbox_union(components: list[dict[str, Any]]) -> dict[str, Any] | None:
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    count = 0
    for component in components:
        bbox = component.get("bbox")
        if not isinstance(bbox, dict):
            continue
        bmin = bbox.get("min")
        bmax = bbox.get("max")
        if not isinstance(bmin, list) or not isinstance(bmax, list) or len(bmin) != 3 or len(bmax) != 3:
            continue
        for index in range(3):
            mins[index] = min(mins[index], safe_float(bmin[index]))
            maxs[index] = max(maxs[index], safe_float(bmax[index]))
        count += 1
    if count == 0:
        return None
    return {
        "count": count,
        "min": mins,
        "max": maxs,
        "size": [maxs[index] - mins[index] for index in range(3)],
    }


def summarize_components(sim_input: Any, registry: Any) -> dict[str, Any]:
    sim_components = sim_input.get("components", []) if isinstance(sim_input, dict) else []
    entities = registry.get("entities", []) if isinstance(registry, dict) else []
    by_kind = Counter(str(c.get("kind", "unknown")) for c in sim_components)
    by_category = Counter(str(c.get("category", "unknown")) for c in sim_components)
    by_material = Counter(str(c.get("material_id", "unknown")) for c in sim_components)
    heat_sources = [
        c for c in sim_components
        if c.get("is_heat_source") or safe_float(c.get("power_W")) != 0
    ]
    radiators = sim_input.get("radiators", []) if isinstance(sim_input, dict) else []

    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "power_W": 0.0, "mass_kg": 0.0})
    for component in sim_components:
        category = str(component.get("category", "unknown"))
        grouped[category]["count"] += 1
        grouped[category]["power_W"] += safe_float(component.get("power_W"))
        grouped[category]["mass_kg"] += safe_float(component.get("mass_kg"))
    category_rows = [{"category": category, **values} for category, values in sorted(grouped.items())]

    suspicious: list[dict[str, Any]] = []
    for ent in entities:
        dims = ent.get("dims") or bbox_dims(ent.get("bbox")) or []
        if len(dims) != 3:
            continue
        dims_f = [safe_float(v) for v in dims]
        if any(v <= 0 for v in dims_f):
            suspicious.append({"component_id": ent.get("component_id"), "reason": "non-positive dimension", "dims": dims_f})
        elif min(dims_f) < 0.5:
            suspicious.append({"component_id": ent.get("component_id"), "reason": "very thin dimension", "dims": dims_f})
        elif max(dims_f) / max(min(dims_f), 1e-9) > 200:
            suspicious.append({"component_id": ent.get("component_id"), "reason": "extreme aspect ratio", "dims": dims_f})

    power_top = sorted(
        [
            {
                "component_id": c.get("component_id"),
                "semantic_name": c.get("semantic_name"),
                "kind": c.get("kind"),
                "category": c.get("category"),
                "power_W": safe_float(c.get("power_W")),
                "mass_kg": safe_float(c.get("mass_kg")),
            }
            for c in sim_components
        ],
        key=lambda item: item["power_W"],
        reverse=True,
    )
    return {
        "simulation_components": len(sim_components),
        "registry_entities": len(entities),
        "heat_source_count": len(heat_sources),
        "radiator_count": len(radiators),
        "total_power_W": sum(safe_float(c.get("power_W")) for c in sim_components),
        "total_mass_kg": sum(safe_float(c.get("mass_kg")) for c in sim_components),
        "by_kind": dict(by_kind),
        "by_category": dict(by_category),
        "by_material": dict(by_material),
        "category_rows": category_rows,
        "power_top": power_top[:12],
        "suspicious": suspicious[:20],
        "bbox_union": bbox_union(sim_components),
        "install_face_count": len(sim_input.get("install_faces", [])) if isinstance(sim_input, dict) else 0,
        "shell_count": len(sim_input.get("shells", [])) if isinstance(sim_input, dict) else 0,
        "cabin_count": len(sim_input.get("cabins", [])) if isinstance(sim_input, dict) else 0,
    }


def summarize_status(status: Any) -> dict[str, Any]:
    checks = status.get("checks", {}) if isinstance(status, dict) else {}
    selections_validation = get_nested(checks, ["selections", "validation"], {}) or {}
    selections_details = selections_validation.get("details", {}) if isinstance(selections_validation, dict) else {}
    heat_sources = get_nested(checks, ["heat_sources", "validation"], {}) or {}
    entity_counts = selections_details.get("entity_counts") or {}
    empty = (
        selections_details.get("empty")
        or selections_details.get("empty_tags")
        or selections_details.get("empty_selections")
        or []
    )
    return {
        "ok": status.get("ok") if isinstance(status, dict) else None,
        "stage": status.get("stage") if isinstance(status, dict) else None,
        "progress_percent": status.get("progress_percent") or status.get("percent") if isinstance(status, dict) else None,
        "error": status.get("error") if isinstance(status, dict) else None,
        "selection_ok": selections_validation.get("ok") if isinstance(selections_validation, dict) else None,
        "selection_message": selections_validation.get("message") if isinstance(selections_validation, dict) else None,
        "selection_expected_count": selections_details.get("expected_count") or len(selections_details.get("expected", []) or []),
        "selection_existing_count": selections_details.get("existing_count") or len(selections_details.get("existing", []) or selections_details.get("existing_tags", []) or []),
        "selection_empty_tags": empty,
        "selection_entity_counts": entity_counts,
        "selection_min_entities": min(entity_counts.values()) if entity_counts else None,
        "selection_max_entities": max(entity_counts.values()) if entity_counts else None,
        "selection_multi_entity_count": sum(1 for value in entity_counts.values() if value > 1) if entity_counts else 0,
        "heat_sources_ok": heat_sources.get("ok") if isinstance(heat_sources, dict) else None,
        "heat_sources_message": heat_sources.get("message") if isinstance(heat_sources, dict) else None,
        "heat_sources_expected_count": get_nested(heat_sources, ["details", "expected_count"]),
        "heat_sources_existing_count": get_nested(heat_sources, ["details", "existing_count"]),
    }


def summarize_cad_validation(validation_report: Any, artifacts: dict[str, Any]) -> dict[str, Any]:
    validation = validation_report if isinstance(validation_report, dict) else {}
    summary = validation.get("summary", {}) if isinstance(validation, dict) else {}
    checks = validation.get("checks", {}) if isinstance(validation, dict) else {}
    bbox = checks.get("bbox", {}) if isinstance(checks, dict) else {}
    mount = checks.get("mount_contact", {}) if isinstance(checks, dict) else checks.get("mount", {})
    occupancy = checks.get("face_occupancy", {}) if isinstance(checks, dict) else {}
    cad_files = [
        artifacts.get("geometry_after_glb", {}),
        artifacts.get("real_cad_glb", {}),
        artifacts.get("power_filtered_step", {}),
        artifacts.get("simulation_input", {}),
    ]
    files_ok = all(item.get("exists") and item.get("size_bytes", 0) > 0 for item in cad_files)
    return {
        "status": validation.get("status") if validation else ("artifacts_ready" if files_ok else "missing_artifacts"),
        "component_count": summary.get("component_count"),
        "bbox_failure_count": summary.get("bbox_failure_count"),
        "bbox_overlap_count": summary.get("bbox_overlap_count"),
        "contact_failure_count": summary.get("contact_failure_count", summary.get("mount_issue_count")),
        "face_occupancy_max": summary.get("face_occupancy_max"),
        "over_capacity_face_count": summary.get("over_capacity_face_count"),
        "overlaps": bbox.get("overlaps", bbox.get("component_overlaps", [])) if isinstance(bbox, dict) else [],
        "contact_failures": mount.get("contact_failures", mount.get("mount_issues", [])) if isinstance(mount, dict) else [],
        "face_occupancy_ok": occupancy.get("ok") if isinstance(occupancy, dict) else None,
    }


def summarize_field_samples(field_samples: Any) -> dict[str, Any]:
    samples = field_samples.get("samples", []) if isinstance(field_samples, dict) else []
    by_component: dict[str, list[float]] = defaultdict(list)
    for sample in samples:
        component_id = str(sample.get("component_id", "unknown"))
        by_component[component_id].append(safe_float(sample.get("temperature_K")))
    component_rows = []
    for component_id, temps in by_component.items():
        component_rows.append({
            "component_id": component_id,
            "count": len(temps),
            "min_K": min(temps),
            "max_K": max(temps),
            "mean_K": sum(temps) / len(temps),
        })
    component_rows.sort(key=lambda item: item["max_K"], reverse=True)
    return {
        "sample_count": len(samples),
        "component_count": len(by_component),
        "component_rows": component_rows,
    }

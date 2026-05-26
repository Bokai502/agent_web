from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable, Mapping

from .common import ValidationResult


ALLOWED_ENTRY_MODES = {"real_bom", "virtual_bom_generation"}
ALLOWED_KINDS = {"internal", "external", "radiator"}
ALLOWED_MOUNT_POLICIES = {"largest_area_face", "category_rule", "random_seeded"}
COMPONENT_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
LOCAL_FACE_RE = re.compile(r"^[a-z]+(min|max)$")


def validate_design_input(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="design_input")
    _require_str(result, data, "schema_version", "design_input")
    _require_str(result, data, "design_id", "design_input")

    units = data.get("units")
    if not isinstance(units, Mapping):
        result.fail("units_present", "units must be an object", "design_input")
    else:
        for key in ("length", "mass", "power"):
            if not units.get(key):
                result.fail("unit_required", f"units.{key} is required", "design_input")

    entry_mode = data.get("entry_mode")
    if entry_mode not in ALLOWED_ENTRY_MODES:
        result.fail(
            "entry_mode_allowed",
            "entry_mode must be real_bom or virtual_bom_generation",
            "design_input",
        )

    source = data.get("source")
    if not isinstance(source, Mapping):
        result.fail("source_present", "source must be an object", "design_input")
        return result

    source_type = source.get("type")
    files = source.get("files")
    if source_type != entry_mode:
        result.fail(
            "source_type_matches_entry_mode",
            "source.type must match entry_mode",
            "design_input",
            "set source.type to the selected entry_mode",
        )
    if not isinstance(files, list) or not files:
        result.fail("source_files_present", "source.files must be a non-empty list", "design_input")
        return result

    file_names = {str(path).split("/")[-1] for path in files}
    if entry_mode == "real_bom" and "real_bom.json" not in file_names:
        result.fail(
            "real_bom_source_file",
            "entry_mode real_bom requires source.files to include real_bom.json",
            "design_input",
        )
    if entry_mode == "virtual_bom_generation" and "virtual_bom_requirements.json" not in file_names:
        result.fail(
            "virtual_requirements_source_file",
            "entry_mode virtual_bom_generation requires source.files to include virtual_bom_requirements.json",
            "design_input",
        )
    if {"real_bom.json", "virtual_bom_requirements.json"}.issubset(file_names):
        result.fail(
            "single_primary_entry",
            "real_bom.json and virtual_bom_requirements.json cannot both be primary source files",
            "design_input",
        )
    return result


def validate_real_bom(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="real_bom")
    _require_str(result, data, "schema_version", "real_bom")
    _require_str(result, data, "bom_id", "real_bom")
    _validate_units(result, data, ("length", "mass", "power"), "real_bom")
    items = _require_list(result, data, "items", "real_bom")
    _validate_bom_items(result, items, require_quantity=True)
    return result


def validate_virtual_bom_requirements(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="virtual_bom_requirements")
    _require_str(result, data, "schema_version", "virtual_bom_requirements")
    _require_str(result, data, "requirements_id", "virtual_bom_requirements")

    if "seed" not in data or not isinstance(data.get("seed"), int):
        result.fail("seed_present", "seed must be present and must be an integer", "virtual_bom_requirements")

    component_count = data.get("component_count")
    if not isinstance(component_count, Mapping):
        result.fail("component_count_present", "component_count must be an object", "virtual_bom_requirements")
    else:
        _validate_min_max(result, component_count, "component_count", "virtual_bom_requirements")

    allowed_kinds = data.get("allowed_kinds")
    if not isinstance(allowed_kinds, list) or not allowed_kinds:
        result.fail("allowed_kinds_present", "allowed_kinds must be a non-empty list", "virtual_bom_requirements")
    else:
        invalid = sorted(set(allowed_kinds) - ALLOWED_KINDS)
        if invalid:
            result.fail(
                "allowed_kinds_valid",
                f"allowed_kinds contains invalid values: {invalid}",
                "virtual_bom_requirements",
            )

    category_requirements = _require_list(
        result,
        data,
        "category_requirements",
        "virtual_bom_requirements",
    )
    total_min = 0
    total_max = 0
    for index, requirement in enumerate(category_requirements):
        object_id = f"category_requirements[{index}]"
        if not isinstance(requirement, Mapping):
            result.fail("category_requirement_object", "category requirement must be an object", object_id)
            continue
        _require_str(result, requirement, "category", object_id)
        _validate_pair_range(result, requirement.get("count_range"), "count_range", object_id, integer=True)
        if isinstance(requirement.get("count_range"), list) and len(requirement["count_range"]) == 2:
            total_min += int(requirement["count_range"][0])
            total_max += int(requirement["count_range"][1])
        _validate_vector_range(result, requirement.get("size_mm_range"), "size_mm_range", object_id)
        _validate_pair_range(result, requirement.get("mass_kg_range"), "mass_kg_range", object_id)
        _validate_pair_range(result, requirement.get("power_W_range"), "power_W_range", object_id)
    if isinstance(component_count, Mapping) and isinstance(component_count.get("min"), int) and isinstance(component_count.get("max"), int):
        if total_min > component_count["max"] or total_max < component_count["min"]:
            result.fail(
                "component_count_feasible",
                "category count ranges must be able to satisfy component_count min/max",
                "virtual_bom_requirements",
            )

    naming_policy = data.get("naming_policy")
    if not isinstance(naming_policy, Mapping) or not naming_policy.get("component_id_prefix"):
        result.fail(
            "component_id_prefix_present",
            "naming_policy.component_id_prefix must be present",
            "virtual_bom_requirements",
        )
    elif not re.match(r"^[A-Z]+$", str(naming_policy["component_id_prefix"]).upper()):
        result.fail(
            "component_id_prefix_valid",
            "naming_policy.component_id_prefix must contain only letters",
            "virtual_bom_requirements",
        )

    mounting_policy = data.get("mounting_policy")
    if not isinstance(mounting_policy, Mapping):
        result.fail("mounting_policy_present", "mounting_policy must be an object", "virtual_bom_requirements")
    else:
        policy = mounting_policy.get("default_mount_face_policy")
        if policy not in ALLOWED_MOUNT_POLICIES:
            result.fail(
                "mounting_policy_supported",
                "default_mount_face_policy must be largest_area_face, category_rule, or random_seeded",
                "virtual_bom_requirements",
            )
        required_fields = mounting_policy.get("required_fields", [])
        required = {"component_mount_face_id", "normal_axis", "normal_sign", "u_axis", "v_axis"}
        if not isinstance(required_fields, list) or not required.issubset(set(required_fields)):
            result.fail(
                "mounting_required_fields",
                "mounting_policy.required_fields must include mount face id and axis fields",
                "virtual_bom_requirements",
            )
    return result


def validate_virtual_bom(
    data: Mapping[str, Any],
    requirements: Mapping[str, Any] | None = None,
) -> ValidationResult:
    result = ValidationResult(stage="virtual_bom")
    _require_str(result, data, "schema_version", "virtual_bom")
    _require_str(result, data, "bom_id", "virtual_bom")
    if not isinstance(data.get("generated_from"), Mapping):
        result.fail("generated_from_present", "generated_from must be an object", "virtual_bom")

    items = _require_list(result, data, "items", "virtual_bom")
    _validate_bom_items(result, items, require_quantity=True)
    _validate_virtual_summary(result, data, items)
    if requirements is not None:
        _validate_items_against_requirements(result, items, requirements)
    return result


def validate_components(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="components")
    _require_str(result, data, "schema_version", "components")
    components = _require_list(result, data, "components", "components")
    _validate_bom_items(result, components, require_quantity=False)
    return result


def _validate_bom_items(
    result: ValidationResult,
    items: list[Any],
    *,
    require_quantity: bool,
) -> None:
    ids: list[str] = []
    for index, item in enumerate(items):
        object_id = f"items[{index}]"
        if not isinstance(item, Mapping):
            result.fail("item_object", "item must be an object", object_id)
            continue
        component_id = item.get("component_id")
        if not isinstance(component_id, str) or not COMPONENT_ID_RE.match(component_id):
            result.fail(
                "component_id_valid",
                "component_id must start with a letter and contain only letters, digits, underscores, or hyphens",
                object_id,
                "keep component_id as the pipeline key; use semantic_name for the external lookup key when needed",
            )
        else:
            ids.append(component_id)
            object_id = component_id

        if not isinstance(item.get("semantic_name"), str) or not item.get("semantic_name").strip():
            result.fail("semantic_name_nonempty", "semantic_name must be a non-empty string", object_id)
        if item.get("kind") not in ALLOWED_KINDS:
            result.fail("kind_allowed", "kind must be internal, external, or radiator", object_id)
        if not isinstance(item.get("category"), str) or not item.get("category").strip():
            result.fail("category_nonempty", "category must be a non-empty string", object_id)
        _validate_vector_positive(result, item.get("size_mm"), "size_mm", object_id)
        _validate_non_negative_number(result, item.get("mass_kg"), "mass_kg", object_id)
        _validate_non_negative_number(result, item.get("power_W"), "power_W", object_id)

        if require_quantity:
            quantity = item.get("quantity")
            if not isinstance(quantity, int) or quantity <= 0:
                result.fail("quantity_positive_integer", "quantity must be a positive integer", object_id)
        elif "quantity" in item:
            result.warn(f"{object_id}: components.json ignores quantity; physical components should be expanded")

        _validate_mounting(result, item, object_id)

    for component_id, count in Counter(ids).items():
        if count > 1:
            result.fail("component_id_unique", f"duplicate component_id {component_id}", component_id)


def _validate_mounting(result: ValidationResult, item: Mapping[str, Any], object_id: str) -> None:
    mounting = item.get("mounting")
    if not isinstance(mounting, Mapping):
        result.fail("mounting_present", "mounting must be an object", object_id)
        return

    default_face = mounting.get("default_component_mount_face_id")
    mount_faces = mounting.get("mount_faces")
    if not isinstance(default_face, str) or not default_face:
        result.fail("default_mount_face_present", "default_component_mount_face_id is required", object_id)
    if not isinstance(mount_faces, list) or not mount_faces:
        result.fail("mount_faces_present", "mount_faces must be a non-empty list", object_id)
        return

    face_ids: set[str] = set()
    component_id = item.get("component_id")
    for index, face in enumerate(mount_faces):
        face_object_id = f"{object_id}.mount_faces[{index}]"
        if not isinstance(face, Mapping):
            result.fail("mount_face_object", "mount face must be an object", face_object_id)
            continue
        face_id = face.get("component_mount_face_id")
        if not isinstance(face_id, str) or not face_id:
            result.fail("component_mount_face_id_present", "component_mount_face_id is required", face_object_id)
        else:
            face_ids.add(face_id)
            face_object_id = face_id
            expected_prefix = f"{component_id}.local_"
            if isinstance(component_id, str) and not face_id.startswith(expected_prefix):
                result.fail(
                    "component_mount_face_id_local",
                    f"component mount face id must start with {expected_prefix}",
                    face_id,
                )

        local_face = face.get("local_face")
        if not isinstance(local_face, str) or not LOCAL_FACE_RE.match(local_face):
            result.fail("local_face_valid", "local_face must be like xmin, xmax, zmin, or zmax", face_object_id)
        _validate_axis(result, face.get("normal_axis"), "normal_axis", face_object_id)
        _validate_axis(result, face.get("u_axis"), "u_axis", face_object_id)
        _validate_axis(result, face.get("v_axis"), "v_axis", face_object_id)
        if face.get("normal_sign") not in (-1, 1):
            result.fail("normal_sign_valid", "normal_sign must be -1 or 1", face_object_id)
        axes = [face.get("normal_axis"), face.get("u_axis"), face.get("v_axis")]
        if all(isinstance(axis, int) for axis in axes) and len(set(axes)) != 3:
            result.fail("mount_face_axes_distinct", "normal_axis, u_axis, and v_axis must be distinct", face_object_id)

    if isinstance(default_face, str) and mount_faces and default_face not in face_ids:
        result.fail(
            "default_mount_face_reference",
            "default_component_mount_face_id must reference an entry in mount_faces",
            object_id,
        )


def _validate_units(
    result: ValidationResult,
    data: Mapping[str, Any],
    required_keys: Iterable[str],
    object_id: str,
) -> None:
    units = data.get("units")
    if not isinstance(units, Mapping):
        result.fail("units_present", "units must be an object", object_id)
        return
    for key in required_keys:
        if not units.get(key):
            result.fail("unit_required", f"units.{key} is required", object_id)


def _require_str(result: ValidationResult, data: Mapping[str, Any], key: str, object_id: str) -> None:
    if not isinstance(data.get(key), str) or not data.get(key).strip():
        result.fail(f"{key}_present", f"{key} must be a non-empty string", object_id)


def _require_list(
    result: ValidationResult,
    data: Mapping[str, Any],
    key: str,
    object_id: str,
) -> list[Any]:
    value = data.get(key)
    if not isinstance(value, list) or not value:
        result.fail(f"{key}_present", f"{key} must be a non-empty list", object_id)
        return []
    return value


def _validate_min_max(
    result: ValidationResult,
    data: Mapping[str, Any],
    key: str,
    object_id: str,
) -> None:
    minimum = data.get("min")
    maximum = data.get("max")
    if not isinstance(minimum, int) or not isinstance(maximum, int):
        result.fail(f"{key}_integer_range", f"{key}.min and {key}.max must be integers", object_id)
        return
    if minimum <= 0 or maximum <= 0 or minimum > maximum:
        result.fail(f"{key}_range_valid", f"{key}.min must be positive and <= max", object_id)


def _validate_pair_range(
    result: ValidationResult,
    value: Any,
    key: str,
    object_id: str,
    *,
    integer: bool = False,
) -> None:
    if not isinstance(value, list) or len(value) != 2:
        result.fail(f"{key}_range_present", f"{key} must be a two item range", object_id)
        return
    expected_type = int if integer else (int, float)
    if not all(isinstance(item, expected_type) for item in value):
        result.fail(f"{key}_numeric", f"{key} bounds must be numeric", object_id)
        return
    if value[0] > value[1]:
        result.fail(f"{key}_ordered", f"{key} lower bound must be <= upper bound", object_id)


def _validate_vector_range(result: ValidationResult, value: Any, key: str, object_id: str) -> None:
    if not isinstance(value, list) or len(value) != 2:
        result.fail(f"{key}_present", f"{key} must contain lower and upper 3D vectors", object_id)
        return
    lower, upper = value
    if not (
        isinstance(lower, list)
        and isinstance(upper, list)
        and len(lower) == 3
        and len(upper) == 3
        and all(isinstance(item, (int, float)) for item in lower + upper)
    ):
        result.fail(f"{key}_vector_numeric", f"{key} bounds must be numeric 3D vectors", object_id)
        return
    for axis, (min_value, max_value) in enumerate(zip(lower, upper)):
        if min_value <= 0 or min_value > max_value:
            result.fail(
                f"{key}_axis_ordered",
                f"{key} axis {axis} lower bound must be positive and <= upper bound",
                object_id,
            )


def _validate_vector_positive(result: ValidationResult, value: Any, key: str, object_id: str) -> None:
    if not isinstance(value, list) or len(value) != 3:
        result.fail(f"{key}_present", f"{key} must be a 3D vector", object_id)
        return
    if not all(isinstance(item, (int, float)) and item > 0 for item in value):
        result.fail(f"{key}_positive", f"{key} values must be positive numbers", object_id)


def _validate_non_negative_number(
    result: ValidationResult,
    value: Any,
    key: str,
    object_id: str,
) -> None:
    if not isinstance(value, (int, float)) or value < 0:
        result.fail(f"{key}_non_negative", f"{key} must be a non-negative number", object_id)


def _validate_axis(result: ValidationResult, value: Any, key: str, object_id: str) -> None:
    if value not in (0, 1, 2):
        result.fail(f"{key}_valid", f"{key} must be 0, 1, or 2", object_id)


def _validate_virtual_summary(
    result: ValidationResult,
    data: Mapping[str, Any],
    items: list[Any],
) -> None:
    summary = data.get("summary")
    if not isinstance(summary, Mapping):
        result.fail("summary_present", "summary must be an object", "virtual_bom")
        return
    valid_items = [item for item in items if isinstance(item, Mapping)]
    expected_count = sum(int(item.get("quantity", 1)) for item in valid_items if isinstance(item.get("quantity", 1), int))
    if summary.get("component_count") != expected_count:
        result.fail(
            "summary_component_count",
            "summary.component_count must equal the total generated component quantity",
            "virtual_bom",
        )
    for summary_key, item_key in (("total_mass_kg", "mass_kg"), ("total_power_W", "power_W")):
        value = summary.get(summary_key)
        expected = sum(float(item.get(item_key, 0.0)) * int(item.get("quantity", 1)) for item in valid_items)
        if not isinstance(value, (int, float)) or abs(float(value) - expected) > 1.0e-6:
            result.fail(
                f"summary_{summary_key}",
                f"summary.{summary_key} must match items",
                "virtual_bom",
            )


def _validate_items_against_requirements(
    result: ValidationResult,
    items: list[Any],
    requirements: Mapping[str, Any],
) -> None:
    category_requirements = requirements.get("category_requirements", [])
    by_category = {
        item.get("category"): item
        for item in category_requirements
        if isinstance(item, Mapping) and isinstance(item.get("category"), str)
    }
    component_count = requirements.get("component_count", {})
    if isinstance(component_count, Mapping):
        total_quantity = sum(int(item.get("quantity", 1)) for item in items if isinstance(item, Mapping))
        if total_quantity < component_count.get("min", 0) or total_quantity > component_count.get("max", total_quantity):
            result.fail("component_count_in_requirements_range", "virtual BOM component_count is outside requirements range", "virtual_bom")
    category_counts: Counter[str] = Counter()
    for item in items:
        if isinstance(item, Mapping) and isinstance(item.get("category"), str):
            category_counts[item["category"]] += int(item.get("quantity", 1))
    for category, category_rule in by_category.items():
        count_range = category_rule.get("count_range")
        if isinstance(count_range, list) and len(count_range) == 2:
            count = category_counts.get(category, 0)
            if count < count_range[0] or count > count_range[1]:
                result.fail(
                    "category_count_in_requirements_range",
                    f"category {category} count is outside requirements range",
                    category,
                )
    allowed_kinds = set(requirements.get("allowed_kinds", []))
    for item in items:
        if not isinstance(item, Mapping):
            continue
        object_id = str(item.get("component_id", "item"))
        if item.get("kind") not in allowed_kinds:
            result.fail("item_kind_in_requirements", "item kind is not allowed by requirements", object_id)
        category_rule = by_category.get(item.get("category"))
        if not category_rule:
            result.fail("item_category_in_requirements", "item category is not defined by requirements", object_id)
            continue
        _check_value_in_range(result, item.get("mass_kg"), category_rule.get("mass_kg_range"), "mass_kg", object_id)
        _check_value_in_range(result, item.get("power_W"), category_rule.get("power_W_range"), "power_W", object_id)
        size = item.get("size_mm")
        size_range = category_rule.get("size_mm_range")
        if isinstance(size, list) and isinstance(size_range, list) and len(size_range) == 2:
            for axis, value in enumerate(size):
                _check_value_in_range(
                    result,
                    value,
                    [size_range[0][axis], size_range[1][axis]],
                    f"size_mm[{axis}]",
                    object_id,
                )


def _check_value_in_range(
    result: ValidationResult,
    value: Any,
    value_range: Any,
    key: str,
    object_id: str,
) -> None:
    if (
        not isinstance(value, (int, float))
        or not isinstance(value_range, list)
        or len(value_range) != 2
        or value < value_range[0]
        or value > value_range[1]
    ):
        result.fail(f"{key}_in_requirements_range", f"{key} is outside requirements range", object_id)

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import openpyxl

from local_defaults import CAD_PREFIX, DATASHEET_PREFIX, IMAGE_PREFIX, MODULE_DB_ROOT, THERMAL_DB

DEFAULT_THERMAL_DB = THERMAL_DB
DEFAULT_CAD_PREFIX = CAD_PREFIX
DEFAULT_MODULE_DB_ROOT = MODULE_DB_ROOT
DEFAULT_IMAGE_PREFIX = IMAGE_PREFIX
DEFAULT_DATASHEET_PREFIX = DATASHEET_PREFIX


def build_module_db_cad_index(
    thermal_db: Path | str = DEFAULT_THERMAL_DB,
    *,
    cad_prefix: Path | str | None = None,
    image_prefix: Path | str | None = None,
    datasheet_prefix: Path | str | None = None,
) -> dict[str, Any]:
    """Build a CAD/Excel lookup table keyed by thermal DB ``器件ID``."""
    thermal_db_path = Path(thermal_db)
    asset_root = thermal_db_path.resolve().parent
    prefix = Path(cad_prefix).resolve() if cad_prefix else asset_root / "cad"
    image_root = Path(image_prefix).resolve() if image_prefix else asset_root / "img"
    datasheet_root = Path(datasheet_prefix).resolve() if datasheet_prefix else asset_root / "datasheet"
    rows = _read_thermal_db_rows(thermal_db_path)
    by_component_id: dict[str, dict[str, Any]] = {}
    for excel_row_number, row in rows:
        component_id = _clean(row.get("器件ID"))
        if not component_id:
            continue
        by_component_id.setdefault(
            component_id,
            _record_from_row(
                row,
                excel_row_number=excel_row_number,
                cad_prefix=prefix,
                image_prefix=image_root,
                datasheet_prefix=datasheet_root,
            ),
        )
    return {
        "thermal_db": str(thermal_db_path),
        "cad_prefix": str(prefix),
        "image_prefix": str(image_root),
        "datasheet_prefix": str(datasheet_root),
        "by_component_id": by_component_id,
    }


def resolve_module_db_cad(
    component: Mapping[str, Any],
    *,
    cad_index: Mapping[str, Any] | None = None,
    thermal_db: Path | str = DEFAULT_THERMAL_DB,
    cad_prefix: Path | str | None = None,
    datasheet_prefix: Path | str | None = None,
) -> dict[str, Any]:
    """Resolve CAD paths and key Excel fields by thermal DB component_id."""
    index = cad_index or build_module_db_cad_index(
        thermal_db,
        cad_prefix=cad_prefix,
        datasheet_prefix=datasheet_prefix,
    )
    source_ref = component.get("source_ref") if isinstance(component.get("source_ref"), Mapping) else {}
    candidates = [
        source_ref.get("thermal_db_component_id"),
        source_ref.get("excel_component_id"),
        component.get("semantic_name"),
        component.get("component_id"),
    ]
    component_id = ""
    by_component_id = index.get("by_component_id") or {}
    for candidate in candidates:
        value = _clean(candidate)
        if value and value in by_component_id:
            component_id = value
            break
    if not component_id:
        component_id = _clean(candidates[0] or candidates[1] or candidates[2] or candidates[3])
    record = by_component_id.get(component_id)
    if not record:
        return {
            "cad_lookup_key": component_id or None,
            "cad_lookup_status": "not_found_by_component_id",
            "cad_path": None,
            "cad_path_exists": False,
            "cad_rotated_path": None,
            "cad_rotated_path_exists": False,
        }
    return dict(record, cad_lookup_key=component_id, cad_lookup_status="matched_component_id")


def display_info_from_excel_record(record: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Select front-end friendly fields from a thermal DB lookup record."""
    if not record:
        return None
    return {
        "semantic_name": record.get("thermal_db_component_id"),
        "model": record.get("excel_model"),
        "name": record.get("excel_name"),
        "name_cn": record.get("excel_name_cn"),
        "kind": record.get("excel_kind"),
        "subsystem": record.get("excel_subsystem"),
        "source": record.get("excel_source"),
        "workbook_row": record.get("excel_workbook_row"),
        "description": record.get("excel_description"),
        "shape": record.get("excel_shape"),
        "dimensions": record.get("excel_dimensions"),
        "mass_g": record.get("excel_mass_g"),
        "power_main": record.get("excel_power_main"),
        "power_calibration": record.get("excel_power_calibration"),
        "power_cooling": record.get("excel_power_cooling"),
        "operating_voltage": record.get("excel_operating_voltage"),
        "material": record.get("excel_material"),
        "mount_face": record.get("excel_mount_face"),
        "thermal": {
            "conductivity_W_mK": record.get("excel_thermal_conductivity"),
            "emissivity": record.get("excel_emissivity"),
            "thermal_resistance_K_W": record.get("excel_thermal_resistance"),
            "contact_resistance_K_W": record.get("excel_contact_resistance"),
            "specific_heat_J_kgK": record.get("excel_specific_heat"),
            "max_temp": record.get("excel_max_temp"),
            "min_temp": record.get("excel_min_temp"),
        },
        "assets": {
            "image_path": record.get("image_path"),
            "image_path_exists": record.get("image_path_exists", False),
            "cad_path": record.get("cad_path"),
            "cad_path_exists": record.get("cad_path_exists", False),
            "cad_rotated_path": record.get("cad_rotated_path"),
            "cad_rotated_path_exists": record.get("cad_rotated_path_exists", False),
            "datasheet_path": record.get("datasheet_path"),
            "datasheet_path_exists": record.get("datasheet_path_exists", False),
        },
    }


def _read_thermal_db_rows(path: Path) -> list[tuple[int, dict[str, Any]]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    worksheet = workbook.active
    header_values = next(worksheet.iter_rows(min_row=1, max_row=1, values_only=True))
    headers = [_clean(value) for value in header_values]
    rows: list[tuple[int, dict[str, Any]]] = []
    for excel_row_number, row_values in enumerate(worksheet.iter_rows(min_row=2, values_only=True), start=2):
        row = {
            header: value
            for header, value in zip(headers, row_values)
            if header
        }
        if _clean(row.get("器件型号")) == "model":
            continue
        rows.append((excel_row_number, row))
    return rows


def _record_from_row(
    row: Mapping[str, Any],
    *,
    excel_row_number: int,
    cad_prefix: Path,
    image_prefix: Path,
    datasheet_prefix: Path,
) -> dict[str, Any]:
    cad_relative = _clean(row.get("CAD路径"))
    cad_rotated_relative = _clean(row.get("CAD_rotated_path")) or _clean(row.get("Rotated CAD Path"))
    image_relative = _clean(row.get("图片路径"))
    datasheet_relative = _clean(row.get("datasheet path"))
    cad_path = _module_path(cad_relative, cad_prefix)
    cad_rotated_path = _module_path(cad_rotated_relative, cad_prefix)
    image_path = _prefixed_asset_path(image_relative, image_prefix, folder_name="img")
    datasheet_path = _prefixed_asset_path(datasheet_relative, datasheet_prefix, folder_name="datasheet")
    return {
        "thermal_db_component_id": _clean(row.get("器件ID")) or None,
        "excel_model": _clean(row.get("器件型号")) or None,
        "excel_name": _clean(row.get("器件名称")) or None,
        "excel_name_cn": _clean(row.get("器件名称(中文)")) or None,
        "excel_workbook_row": excel_row_number,
        "excel_description": _clean(row.get("描述 / 用途说明）")) or None,
        "excel_shape": _clean(row.get("外形")) or None,
        "excel_dimensions": _clean(row.get("尺寸")) or None,
        "excel_kind": _clean(row.get("器件种类")) or None,
        "excel_subsystem": _clean(row.get("所属分系统")) or None,
        "excel_source": _clean(row.get("器件来源")) or None,
        "excel_material": _clean(row.get("核心材料")) or None,
        "excel_mount_face": _clean(row.get("安装面")) or None,
        "excel_mass_g": row.get("质量 g"),
        "excel_power_main": _clean(row.get("主模式功耗")) or None,
        "excel_power_calibration": _clean(row.get("校准模式功耗")) or None,
        "excel_power_cooling": _clean(row.get("冷却系统功耗")) or None,
        "excel_operating_voltage": _clean(row.get("工作电压")) or None,
        "excel_thermal_conductivity": row.get("导热率W/(m·K)"),
        "excel_emissivity": row.get("辐射率"),
        "excel_thermal_resistance": row.get("热阻K/W"),
        "excel_contact_resistance": row.get("接触热阻K/W"),
        "excel_specific_heat": row.get("比热容J/(kg·K)"),
        "excel_max_temp": row.get("最高工作温度"),
        "excel_min_temp": row.get("最低工作温度"),
        "image_relative_path": image_relative or None,
        "image_path": str(image_path) if image_path else None,
        "image_path_exists": bool(image_path and image_path.exists()),
        "datasheet_relative_path": datasheet_relative or None,
        "datasheet_path": str(datasheet_path) if datasheet_path else None,
        "datasheet_path_exists": bool(datasheet_path and datasheet_path.exists()),
        "cad_relative_path": cad_relative or None,
        "cad_path": str(cad_path) if cad_path else None,
        "cad_path_exists": bool(cad_path and cad_path.exists()),
        "cad_rotated_relative_path": cad_rotated_relative or None,
        "cad_rotated_path": str(cad_rotated_path) if cad_rotated_path else None,
        "cad_rotated_path_exists": bool(cad_rotated_path and cad_rotated_path.exists()),
    }


def _module_path(raw_path: str, cad_prefix: Path) -> Path | None:
    if not raw_path:
        return None
    path = Path(raw_path)
    if path.is_absolute():
        return path
    parts = path.parts
    if parts and parts[0] == "cad":
        return cad_prefix.joinpath(*parts[1:])
    if parts and parts[0] == "cad_rotated":
        return cad_prefix.parent.joinpath("cad_rotated", *parts[1:])
    return cad_prefix / path


def _prefixed_asset_path(raw_path: str, prefix: Path, *, folder_name: str) -> Path | None:
    if not raw_path:
        return None
    path = Path(raw_path)
    if path.is_absolute():
        return path
    parts = path.parts
    if parts and parts[0] == folder_name:
        return prefix.joinpath(*parts[1:])
    return prefix / path


def _clean(value: Any) -> str:
    return str(value or "").strip()

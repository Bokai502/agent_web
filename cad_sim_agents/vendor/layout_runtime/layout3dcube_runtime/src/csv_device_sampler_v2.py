from __future__ import annotations

import csv
import json
import random
import re
from pathlib import Path
from typing import Any, Dict, List

from src.sample_processor_v2 import (
    CATEGORY_COLORS,
    KIND_TINTS,
    PartV2,
    generate_sample_config_v2,
    process_prebuilt_sample_v2,
)
from src.util import load_config


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\t", " ").strip().strip('"').strip()


def _normalize_header(value: str) -> str:
    text = _clean_text(value).lower()
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _parse_float(value: Any) -> float | None:
    text = _clean_text(value)
    if not text:
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _parse_power_w(value: Any) -> float:
    text = _clean_text(value)
    if not text:
        return 0.0
    lower = text.lower()
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", lower)
    if not numbers:
        return 0.0
    power = max(float(x) for x in numbers)
    if "mw" in lower and "w" not in lower.replace("mw", ""):
        power /= 1000.0
    return power


def _parse_dims_mm(row: Dict[str, str]) -> List[float] | None:
    direct = [
        _parse_float(row.get("length")),
        _parse_float(row.get("width")),
        _parse_float(row.get("height")),
    ]
    if all(v and v > 0 for v in direct):
        return [float(v) for v in direct]

    body = [
        _parse_float(row.get("body_length")),
        _parse_float(row.get("body_width")),
        _parse_float(row.get("body_height")),
    ]
    if all(v and v > 0 for v in body):
        return [float(v) for v in body]

    dimensions = _clean_text(row.get("dimensions"))
    nums = re.findall(r"[-+]?\d+(?:\.\d+)?", dimensions)
    if len(nums) >= 3:
        dims = [float(nums[0]), float(nums[1]), float(nums[2])]
        if all(v > 0 for v in dims):
            return dims
    return None


def _pick_first_nonempty(row: Dict[str, str], keys: List[str]) -> str:
    for key in keys:
        value = _clean_text(row.get(key))
        if value:
            return value
    return ""


def _canonical_field_map(headers: List[str]) -> Dict[int, str]:
    canonical: Dict[int, str] = {}
    for idx, header in enumerate(headers):
        normalized = _normalize_header(header)
        if normalized:
            canonical[idx] = normalized
    return canonical


def load_csv_device_records(csv_path: Path) -> List[Dict[str, Any]]:
    with open(csv_path, "r", encoding="gbk", errors="replace", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if len(rows) < 2:
        raise ValueError(f"CSV 表头不足两行: {csv_path}")

    header_cn = rows[0]
    header_en = rows[1]
    merged_headers = []
    for idx in range(max(len(header_cn), len(header_en))):
        merged_headers.append(
            header_en[idx] if idx < len(header_en) and _clean_text(header_en[idx]) else header_cn[idx]
        )

    field_map = _canonical_field_map(merged_headers)
    records: List[Dict[str, Any]] = []

    for raw in rows[2:]:
        row = {
            field_map[idx]: _clean_text(raw[idx])
            for idx in range(min(len(raw), len(merged_headers)))
            if idx in field_map
        }
        dims_mm = _parse_dims_mm(row)
        if not dims_mm:
            continue

        mass_g = _parse_float(row.get("mass"))
        power_w = 0.0
        for key in ("power_main_mode", "power_calibration_mode", "power_cooling_system"):
            power_w = max(power_w, _parse_power_w(row.get(key)))

        record = {
            "model": _pick_first_nonempty(row, ["model"]),
            "name": _pick_first_nonempty(row, ["name", "device_name"]),
            "shape": _pick_first_nonempty(row, ["shape"]),
            "description": _pick_first_nonempty(row, ["description", "description_"]),
            "dims_mm": dims_mm,
            "mass_kg": (mass_g / 1000.0) if mass_g is not None else 0.1,
            "power_w": power_w,
            "material": _pick_first_nonempty(row, ["material"]),
            "mount_face": _pick_first_nonempty(row, ["z", "mount_face"]),
            "belong_path": _pick_first_nonempty(row, ["belong_path"]),
            "cad_path": _pick_first_nonempty(row, ["cad_path", "cad_path_"]),
            "img_path": _pick_first_nonempty(row, ["img_path"]),
            "datasheet_path": _pick_first_nonempty(row, ["datasheet_path"]),
            "thermal_interface": {
                "contact_resistance": _parse_float(row.get("contact_resistance")) or 0.5,
            },
            "thermal_surface": {
                "emissivity": 0.8,
                "absorptivity": 0.3,
            },
            "raw": row,
        }
        records.append(record)

    return records


_EXTERNAL_KEYWORDS = (
    "thruster",
    "antenna",
    "sensor",
    "star tracker",
    "tracker",
    "gps",
    "camera",
    "payload",
    "推进",
    "天线",
    "相机",
    "星敏",
)


def infer_kind_from_record(record: Dict[str, Any]) -> str:
    haystack = " ".join(
        [
            _clean_text(record.get("name")),
            _clean_text(record.get("model")),
            _clean_text(record.get("description")),
            _clean_text(record.get("belong_path")),
        ]
    ).lower()
    if any(keyword in haystack for keyword in _EXTERNAL_KEYWORDS):
        return "external"
    return "internal"


def infer_category_from_record(record: Dict[str, Any]) -> str:
    text = " ".join([
        _clean_text(record.get("belong_path")),
        _clean_text(record.get("name")),
        _clean_text(record.get("description")),
    ]).lower()
    if any(token in text for token in ("power", "电源", "pcdu", "eps")):
        return "power"
    if any(token in text for token in ("payload", "相机", "camera")):
        return "payload"
    if any(token in text for token in ("thermal", "热控")):
        return "thermal"
    return "avionics"


def _build_part(record: Dict[str, Any], index: int, clearance_mm: float) -> PartV2:
    kind = infer_kind_from_record(record)
    prefix = "E" if kind == "external" else "P"
    category = infer_category_from_record(record)
    color = KIND_TINTS.get(kind) or CATEGORY_COLORS.get(category, CATEGORY_COLORS["default"])
    return PartV2(
        id=f"{prefix}_{index:03d}_{kind}",
        kind=kind,
        category=category,
        dims=tuple(float(v) for v in record["dims_mm"]),
        mass=max(float(record.get("mass_kg") or 0.1), 0.01),
        power=max(float(record.get("power_w") or 0.0), 0.0),
        color=color,
        clearance_mm=clearance_mm,
        model=_clean_text(record.get("model")),
        thermal_surface=dict(record.get("thermal_surface") or {}),
        thermal_interface=dict(record.get("thermal_interface") or {}),
    )


def generate_sample_directory_from_csv(
    csv_path: Path,
    output_dir: Path,
    n: int,
    seed: int,
    dist_path: Path,
    sample_id: str,
) -> Dict[str, Any]:
    records = load_csv_device_records(csv_path)
    if len(records) < n:
        raise ValueError(f"可用设备不足: requested={n}, available={len(records)}")

    rng = random.Random(seed)
    selected = rng.sample(records, n)
    dist = load_config(str(dist_path))
    sample_config = generate_sample_config_v2(dist, sample_id, seed)
    clearance = float(sample_config["packing"]["clearance"])
    parts = [_build_part(record, index, clearance) for index, record in enumerate(selected)]

    output_dir.mkdir(parents=True, exist_ok=True)
    stats = process_prebuilt_sample_v2(
        sample_config=sample_config,
        output_dir=output_dir,
        dist=dist,
        parts=parts,
    )

    selection_manifest = {
        "csv_path": str(csv_path),
        "sample_id": sample_id,
        "seed": seed,
        "selected_count": len(selected),
        "selected_devices": [
            {
                "model": record.get("model"),
                "name": record.get("name"),
                "dims_mm": record.get("dims_mm"),
                "mass_kg": record.get("mass_kg"),
                "power_w": record.get("power_w"),
                "kind": infer_kind_from_record(record),
            }
            for record in selected
        ],
        "stats": stats,
    }
    qc_dir = output_dir / "qc"
    qc_dir.mkdir(parents=True, exist_ok=True)
    (qc_dir / "csv_selection.json").write_text(
        json.dumps(selection_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "sample_id": sample_id,
        "selected_count": len(selected),
        "output_dir": str(output_dir),
    }

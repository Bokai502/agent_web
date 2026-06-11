from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import pandas as pd

from .schema import ComponentRecord

COLUMN_ALIASES = {
    "model": ["型号规格", "型号", "器件型号", "元器件型号", "component_model", "model"],
    "name": ["元器件名称", "元器件名 称", "名称", "器件名称", "component_name", "name"],
    "quality_level": ["质量等级", "等级", "quality_level"],
    "package_type": ["封装形式", "封装", "package_type"],
    "working_temp": ["工作温度", "温度范围", "working_temp"],
    "manufacturer": ["生产厂商", "厂商", "制造商", "manufacturer_name", "manufacturer"],
    "flight_history": ["飞行经历", "应用经历", "flight_status", "flight_history"],
    "is_low_quality": ["低等级", "是否低等级", "is_low_quality"],
    "is_key_part": ["关键部位", "关键件", "是否关键件", "is_key_part"],
}

REQUIRED_FIELDS = ["model", "name", "manufacturer", "package_type"]


def _clean(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def _truthy(value) -> bool:
    text = _clean(value).lower()
    return text in {"是", "true", "1", "yes", "y", "关键", "低等级"}


def _best_header(raw_df: pd.DataFrame) -> pd.DataFrame:
    best_df = pd.DataFrame()
    best_score = -1
    for header_idx in range(min(3, len(raw_df))):
        header = raw_df.iloc[header_idx].fillna("").astype(str).str.strip()
        candidate = raw_df.iloc[header_idx + 1 :].reset_index(drop=True).copy()
        candidate.columns = header
        candidate = candidate.loc[
            :, [str(col).strip() != "" for col in candidate.columns]
        ]
        score = sum(
            1
            for aliases in COLUMN_ALIASES.values()
            for col in aliases
            if col in candidate.columns
        )
        if score > best_score:
            best_score = score
            best_df = candidate
    return best_df


def _flatten_multiline_header(
    raw_df: pd.DataFrame, header_idx: int, header_rows: int = 2
) -> pd.DataFrame:
    if raw_df is None or raw_df.empty or len(raw_df) <= header_idx:
        return pd.DataFrame()
    header_block = (
        raw_df.iloc[header_idx : min(header_idx + header_rows, len(raw_df))]
        .astype(str)
        .replace("nan", "")
    )
    headers = []
    for col in header_block.columns:
        parts = [
            part.strip()
            for part in header_block[col].tolist()
            if part and part.strip() and part.strip() != "nan"
        ]
        headers.append(
            parts[-1]
            if parts and parts[-1] not in {"规格", "生产单位"}
            else (parts[0] if parts else "")
        )
    candidate = raw_df.iloc[header_idx + header_rows :].reset_index(drop=True).copy()
    candidate.columns = headers
    return candidate.loc[:, [str(col).strip() != "" for col in candidate.columns]]


def _read_table(path: Path, sheet_name: str | None = None) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        excel = pd.ExcelFile(path)
        sheets = (
            [sheet_name]
            if sheet_name and sheet_name in excel.sheet_names
            else excel.sheet_names
        )
        best = pd.DataFrame()
        best_score = -1
        for sheet in sheets:
            raw = pd.read_excel(path, sheet_name=sheet, header=None)
            candidates = [_best_header(raw)]
            candidates.extend(
                _flatten_multiline_header(raw, idx) for idx in range(min(3, len(raw)))
            )
            for candidate in candidates:
                score = sum(
                    1
                    for aliases in COLUMN_ALIASES.values()
                    for col in aliases
                    if col in candidate.columns
                )
                if score > best_score:
                    best_score = score
                    best = candidate
        return best
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix == ".json":
        data = pd.read_json(path)
        return data if isinstance(data, pd.DataFrame) else pd.DataFrame(data)
    raise ValueError(f"Unsupported table format: {path}")


def _value(row, field: str) -> str:
    for col in COLUMN_ALIASES[field]:
        if col in row:
            value = _clean(row[col])
            if value:
                return value
    return ""


def load_components(
    path: Path, sheet_name: str | None = None
) -> tuple[list[ComponentRecord], list[str]]:
    df = _read_table(path, sheet_name)
    records: list[ComponentRecord] = []
    missing = []
    for field in REQUIRED_FIELDS:
        if not any(col in df.columns for col in COLUMN_ALIASES[field]):
            missing.append(field)
    if missing:
        return [], missing

    for _idx, row in df.iterrows():
        data = row.to_dict()
        model = _value(data, "model")
        name = _value(data, "name") or model
        if not model and not name:
            continue
        records.append(
            ComponentRecord(
                index=len(records) + 1,
                model=model,
                name=name,
                quality_level=_value(data, "quality_level"),
                package_type=_value(data, "package_type"),
                working_temp=_value(data, "working_temp"),
                manufacturer=_value(data, "manufacturer"),
                flight_history=_value(data, "flight_history"),
                is_low_quality=_truthy(_value(data, "is_low_quality")),
                is_key_part=_truthy(_value(data, "is_key_part")),
            )
        )
    return records, []


def load_reference_rows(path: Path | None) -> list[dict]:
    if not path:
        return []
    df = _read_table(path)
    df = df.copy()
    df.columns = _dedupe_columns([str(col) for col in df.columns])
    return [
        {str(k): _clean(v) for k, v in row.items()}
        for row in df.to_dict(orient="records")
    ]


def _dedupe_columns(columns: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    output = []
    for col in columns:
        key = col.strip()
        if key not in counts:
            counts[key] = 0
            output.append(key)
        else:
            counts[key] += 1
            output.append(f"{key}_{counts[key]}")
    return output


def _row_value(row: dict, field: str) -> str:
    for col in COLUMN_ALIASES[field]:
        if col in row:
            value = _clean(row[col])
            if value:
                return value
    return ""


def unique(values: Iterable[str]) -> list[str]:
    return sorted({v for v in values if v})

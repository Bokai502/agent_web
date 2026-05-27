#!/usr/bin/env python3
"""Convert a simple XLSX worksheet to JSON.

Usage:
    python data_jiange/xlsx_to_json.py input.xlsx
    python data_jiange/xlsx_to_json.py input.xlsx -o output.json
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def col_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")

    idx = 0
    for ch in match.group(1):
        idx = idx * 26 + ord(ch) - ord("A") + 1
    return idx - 1


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []

    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.findall(".//a:t", NS))
        for si in root.findall("a:si", NS)
    ]


def parse_raw_value(raw: str | None):
    if raw is None:
        return None

    raw = raw.strip()
    if raw == "":
        return None

    if re.fullmatch(r"-?\d+", raw):
        return int(raw)

    float_pattern = r"-?(?:\d+\.\d*|\d*\.\d+)(?:[Ee][+-]?\d+)?|-?\d+[Ee][+-]?\d+"
    if re.fullmatch(float_pattern, raw):
        return float(raw)

    return raw


def cell_value(cell: ET.Element, shared_strings: list[str]):
    cell_type = cell.attrib.get("t")

    if cell_type == "inlineStr":
        text = "".join(t.text or "" for t in cell.findall(".//a:t", NS))
        return parse_raw_value(text)

    value_node = cell.find("a:v", NS)
    if value_node is None:
        return None

    raw = value_node.text
    if cell_type == "s":
        return shared_strings[int(raw)]
    if cell_type == "b":
        return raw == "1"

    return parse_raw_value(raw)


def normalize_header(text) -> str:
    return re.sub(r"\s+", "", str(text)).strip()


def read_first_sheet(xlsx_path: Path) -> tuple[str, list[list[object | None]]]:
    with ZipFile(xlsx_path) as zip_file:
        workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
        sheet = workbook.find("a:sheets/a:sheet", NS)
        sheet_name = sheet.attrib.get("name", "Sheet1") if sheet is not None else "Sheet1"

        shared_strings = load_shared_strings(zip_file)
        root = ET.fromstring(zip_file.read("xl/worksheets/sheet1.xml"))

        rows: list[list[object | None]] = []
        max_cols = 0
        for row in root.findall(".//a:sheetData/a:row", NS):
            values: list[object | None] = []
            for cell in row.findall("a:c", NS):
                idx = col_index(cell.attrib["r"])
                while len(values) <= idx:
                    values.append(None)
                values[idx] = cell_value(cell, shared_strings)

            max_cols = max(max_cols, len(values))
            rows.append(values)

    for row in rows:
        row.extend([None] * (max_cols - len(row)))

    return sheet_name, rows


def build_columns(header_top: list[object | None], header_sub: list[object | None], max_cols: int) -> list[str]:
    columns: list[str] = []
    last_top: str | None = None

    for i in range(max_cols):
        top = normalize_header(header_top[i]) if i < len(header_top) and header_top[i] else None
        sub = normalize_header(header_sub[i]) if i < len(header_sub) and header_sub[i] else None

        if top:
            last_top = top
        effective_top = top or last_top

        if effective_top and sub and sub != effective_top:
            name = f"{effective_top}_{sub}"
        else:
            name = effective_top or sub or f"column_{i + 1}"
        columns.append(name)

    seen: dict[str, int] = {}
    unique_columns: list[str] = []
    for name in columns:
        count = seen.get(name, 0)
        seen[name] = count + 1
        unique_columns.append(name if count == 0 else f"{name}_{count + 1}")

    return unique_columns


def convert_xlsx_to_json(xlsx_path: Path, json_path: Path) -> dict:
    sheet_name, rows = read_first_sheet(xlsx_path)
    max_cols = max((len(row) for row in rows), default=0)

    title = rows[0][0] if rows and rows[0] else None
    header_top = rows[1] if len(rows) > 1 else []
    header_sub = rows[2] if len(rows) > 2 else []
    columns = build_columns(header_top, header_sub, max_cols)

    records = []
    for row in rows[3:]:
        if not any(value is not None and value != "" for value in row):
            continue
        records.append({columns[i]: row[i] for i in range(max_cols)})

    payload = {
        "source": str(xlsx_path),
        "sheet": sheet_name,
        "title": title,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "row_count": len(records),
        "columns": columns,
        "data": records,
    }

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert an XLSX table to JSON.")
    parser.add_argument("xlsx_path", type=Path, help="Input .xlsx file path")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output .json file path. Defaults to the input path with .json suffix.",
    )
    args = parser.parse_args()

    xlsx_path = args.xlsx_path.expanduser().resolve()
    if not xlsx_path.exists():
        parser.error(f"Input file does not exist: {xlsx_path}")
    if xlsx_path.suffix.lower() != ".xlsx":
        parser.error(f"Input file must be .xlsx: {xlsx_path}")

    json_path = args.output.expanduser().resolve() if args.output else xlsx_path.with_suffix(".json")
    payload = convert_xlsx_to_json(xlsx_path, json_path)

    print(json_path)
    print(f"rows: {payload['row_count']}")
    print(f"columns: {', '.join(payload['columns'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Read a derating XLSX, classify component subclasses, and write JSON."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET
from zipfile import ZipFile


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = Path("/data/lbk/codex_web/data_jiange/inputs_data/00_inputs/降额test1.xlsx")
DEFAULT_DATA = SKILL_DIR / "reference" / "jiange_full.json"
DEFAULT_OUTPUT_DIR = SKILL_DIR / "outputs"

INPUT_COLS = [
    "序号",
    "元器件名称",
    "型号规格",
    "生产厂商",
    "降额参数",
    "额定值",
    "允许值",
    "实际值",
    "降额因子_规定",
    "降额因子_实际",
    "降额等级",
    "备注",
]

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"a": SPREADSHEET_NS, "r": REL_NS}


RULES: list[dict[str, str]] = [
    {
        "pattern": r"(瓷介|陶瓷电容|cc41|ct41)",
        "category": "电容器",
        "subclass": "固定陶瓷电容器",
        "reason": "名称或型号包含瓷介/陶瓷电容特征。",
    },
    {
        "pattern": r"(钽电容|钽电解)",
        "category": "电容器",
        "subclass": "钽电解电容器",
        "reason": "名称包含钽电容特征。",
    },
    {
        "pattern": r"(铝电解)",
        "category": "电容器",
        "subclass": "铝电解电容器",
        "reason": "名称包含铝电解电容特征。",
    },
    {
        "pattern": r"(薄膜电容|纸介电容|塑料薄膜电容)",
        "category": "电容器",
        "subclass": "固定纸/塑料薄膜电容器",
        "reason": "名称包含纸介或塑料薄膜电容特征。",
    },
    {
        "pattern": r"(云母电容)",
        "category": "电容器",
        "subclass": "固定云母电容器",
        "reason": "名称包含云母电容特征。",
    },
    {
        "pattern": r"(玻璃釉电容)",
        "category": "电容器",
        "subclass": "固定玻璃釉电容器",
        "reason": "名称包含玻璃釉电容特征。",
    },
    {
        "pattern": r"(运算放大器|运放|opamp|op-amp)",
        "category": "集成电路",
        "subclass": "模拟电路-放大器",
        "reason": "运算放大器属于放大器类模拟电路。",
    },
    {
        "pattern": r"(比较器)",
        "category": "集成电路",
        "subclass": "模拟电路-比较器",
        "reason": "名称包含比较器特征。",
    },
    {
        "pattern": r"(电源管理|pmic|电压调整|稳压芯片|ldo|dcdc|dc-dc)",
        "category": "集成电路",
        "subclass": "模拟电路-电压调整器",
        "reason": "电源管理/稳压类芯片最接近电压调整器类模拟电路。",
    },
    {
        "pattern": r"(电压参考芯片|电压基准芯片|基准源|参考源)",
        "category": "集成电路",
        "subclass": "模拟电路-电压调整器",
        "reason": "电压参考芯片按参考/调整功能归入电压调整器类模拟电路。",
    },
    {
        "pattern": r"(模拟开关)",
        "category": "集成电路",
        "subclass": "模拟电路-模拟开关",
        "reason": "名称包含模拟开关特征。",
    },
    {
        "pattern": r"(ad转换|a/d|adc|da转换|d/a|dac|模数|数模)",
        "category": "集成电路",
        "subclass": "混合集成电路",
        "reason": "AD/DA 转换器同时包含模拟和数字功能，归入混合集成电路。",
    },
    {
        "pattern": r"(fpga|asic|cpld)",
        "category": "集成电路",
        "subclass": "大规模集成电路",
        "reason": "FPGA/ASIC/CPLD 属于大规模集成电路。",
    },
    {
        "pattern": r"(接口电路|接口芯片|收发器|rs485|rs422|can收发|lvds)",
        "category": "集成电路",
        "subclass": "数字电路-MOS型",
        "reason": "接口电路通常按数字 CMOS/MOS 型集成电路处理。",
    },
    {
        "pattern": r"(数字温度传感器|温度传感器)",
        "category": "集成电路",
        "subclass": "数字电路-MOS型",
        "reason": "数字温度传感器按数字 MOS 型集成电路处理。",
    },
    {
        "pattern": r"(ttl|双极型数字)",
        "category": "集成电路",
        "subclass": "数字电路-双极型",
        "reason": "名称包含双极型数字电路特征。",
    },
    {
        "pattern": r"(稳压二极管|齐纳|基准二极管)",
        "category": "分立半导体器件",
        "subclass": "基准二极管",
        "reason": "稳压/齐纳二极管对应基准二极管。",
    },
    {
        "pattern": r"(微波二极管)",
        "category": "分立半导体器件",
        "subclass": "微波二极管",
        "reason": "名称包含微波二极管特征。",
    },
    {
        "pattern": r"(场效应管|mosfet|mos管|三极管|晶体管|达林顿)",
        "category": "分立半导体器件",
        "subclass": "晶体管",
        "reason": "场效应管/三极管/达林顿管均归入晶体管类分立半导体器件。",
    },
    {
        "pattern": r"(二极管)",
        "category": "分立半导体器件",
        "subclass": "二极管(基准管除外)",
        "reason": "普通二极管归入二极管(基准管除外)。",
    },
    {
        "pattern": r"(电阻网络|排阻)",
        "category": "固定电阻器",
        "subclass": "电阻网络",
        "reason": "名称包含电阻网络/排阻特征。",
    },
    {
        "pattern": r"(线绕电阻)",
        "category": "固定电阻器",
        "subclass": "线绕电阻器",
        "reason": "名称包含线绕电阻特征。",
    },
    {
        "pattern": r"(片式固定电阻器|贴片电阻|片阻|固定电阻|电阻器|电阻)",
        "category": "固定电阻器",
        "subclass": "薄膜型电阻器",
        "reason": "片式固定电阻器通常按薄膜型固定电阻器处理。",
    },
    {
        "pattern": r"(热敏电阻|ntc|ptc)",
        "category": "热敏电阻器",
        "subclass": "全类型",
        "reason": "热敏电阻在标准中使用热敏电阻器/全类型。",
    },
    {
        "pattern": r"(扼流圈)",
        "category": "电感元件",
        "subclass": "扼流圈",
        "reason": "名称包含扼流圈特征。",
    },
    {
        "pattern": r"(电感|磁珠)",
        "category": "电感元件",
        "subclass": "全类型",
        "reason": "电感/磁珠按电感元件通用类型处理。",
    },
    {
        "pattern": r"(晶振|晶体振荡|振荡器|晶体谐振|晶体)",
        "category": "晶体",
        "subclass": "全类型",
        "reason": "晶振/晶体在标准中使用晶体/全类型。",
    },
    {
        "pattern": r"(电连接器|连接器|插座|插头)",
        "category": "连接器",
        "subclass": "全类型",
        "reason": "连接器在标准中使用连接器/全类型。",
    },
    {
        "pattern": r"(熔断器|保险丝)",
        "category": "保险丝",
        "subclass": "电流额定值",
        "reason": "熔断器对应保险丝，标准子类为电流额定值。",
    },
    {
        "pattern": r"(继电器)",
        "category": "继电器",
        "subclass": "全类型",
        "reason": "未指定触点负载类型时按继电器/全类型处理。",
    },
    {
        "pattern": r"(开关)",
        "category": "开关",
        "subclass": "全类型",
        "reason": "未指定触点负载类型时按开关/全类型处理。",
    },
    {
        "pattern": r"(电机|马达)",
        "category": "电机",
        "subclass": "全类型",
        "reason": "电机在标准中使用电机/全类型。",
    },
    {
        "pattern": r"(导线|电缆)",
        "category": "导线与电缆",
        "subclass": "全类型",
        "reason": "未指定 AWG 线规时按导线与电缆/全类型处理。",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read a derating XLSX, classify 元器件子类, and write JSON."
    )
    parser.add_argument(
        "xlsx",
        nargs="?",
        default=str(DEFAULT_INPUT),
        help=f"Input XLSX path. Defaults to {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--data",
        default=str(DEFAULT_DATA),
        help="Path to jiange_full.json.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory for the generated JSON when --output is not set.",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output JSON path. Defaults to <output-dir>/<xlsx-stem>_classification.json.",
    )
    parser.add_argument(
        "--no-reference",
        action="store_true",
        help="Do not include matching reference rows in component summaries.",
    )
    return parser.parse_args()


def normalize_serial(value: str) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text


def normalize_header_cell(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip())


def normalize_match_text(*parts: object) -> str:
    text = "".join(str(part or "") for part in parts).casefold()
    return re.sub(r"\s+", "", text)


def col_to_index(col_ref: str) -> int:
    value = 0
    for ch in col_ref:
        value = value * 26 + ord(ch.upper()) - 64
    return value - 1


def cell_col_index(cell_ref: str) -> int | None:
    match = re.match(r"([A-Z]+)\d+", cell_ref or "")
    return col_to_index(match.group(1)) if match else None


def read_shared_strings(zf: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []

    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("a:si", NS):
        texts = [node.text or "" for node in si.findall(".//a:t", NS)]
        values.append("".join(texts))
    return values


def read_workbook_sheets(zf: ZipFile) -> list[tuple[str, str]]:
    names = set(zf.namelist())
    if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        return [("sheet1", "xl/worksheets/sheet1.xml")]

    rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rels = {
        rel.attrib.get("Id", ""): rel.attrib.get("Target", "")
        for rel in rel_root.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
    }

    workbook_root = ET.fromstring(zf.read("xl/workbook.xml"))
    sheets = []
    for sheet in workbook_root.findall(".//a:sheets/a:sheet", NS):
        sheet_name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(f"{{{REL_NS}}}id", "")
        target = rels.get(rel_id, "")
        if not target:
            continue
        sheet_path = target.lstrip("/")
        if not sheet_path.startswith("xl/"):
            sheet_path = "xl/" + sheet_path
        sheets.append((sheet_name, sheet_path))
    return sheets or [("sheet1", "xl/worksheets/sheet1.xml")]


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//a:t", NS)).strip()

    value_node = cell.find("a:v", NS)
    value = "" if value_node is None or value_node.text is None else value_node.text
    if cell_type == "s" and value:
        try:
            return shared_strings[int(value)].strip()
        except (IndexError, ValueError):
            return value.strip()
    return value.strip()


def read_sheet_rows(
    zf: ZipFile, sheet_path: str, shared_strings: list[str]
) -> list[tuple[int, list[str]]]:
    root = ET.fromstring(zf.read(sheet_path))
    rows = []
    for row in root.findall(".//a:sheetData/a:row", NS):
        row_num = int(row.attrib.get("r", len(rows) + 1))
        values_by_col: dict[int, str] = {}
        for cell in row.findall("a:c", NS):
            col_idx = cell_col_index(cell.attrib.get("r", ""))
            if col_idx is None:
                continue
            values_by_col[col_idx] = read_cell_value(cell, shared_strings)
        if not values_by_col:
            rows.append((row_num, []))
            continue
        max_col = max(values_by_col)
        rows.append((row_num, [values_by_col.get(idx, "") for idx in range(max_col + 1)]))
    return rows


def find_derating_header(rows: list[tuple[int, list[str]]]) -> tuple[int, int] | None:
    for row_idx, (_, row_values) in enumerate(rows):
        cells = [normalize_header_cell(value) for value in row_values]
        row_text = "|".join(value for value in cells if value)
        if all(token in row_text for token in ["序号", "型号规格", "降额参数"]):
            try:
                start_col = cells.index("序号")
            except ValueError:
                start_col = 0
            return row_idx, start_col
    return None


def has_derating_subheader(rows: list[tuple[int, list[str]]], row_idx: int) -> bool:
    if row_idx >= len(rows):
        return False
    row_text = "|".join(normalize_header_cell(value) for value in rows[row_idx][1])
    return all(token in row_text for token in ["额定", "允许", "实际"])


def read_xlsx_derating_rows(xlsx_path: Path) -> tuple[dict[str, object], list[dict[str, str]]]:
    with ZipFile(xlsx_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_errors = []
        for sheet_name, sheet_path in read_workbook_sheets(zf):
            if sheet_path not in zf.namelist():
                sheet_errors.append(f"{sheet_name}: worksheet xml not found: {sheet_path}")
                continue
            sheet_rows = read_sheet_rows(zf, sheet_path, shared_strings)
            header = find_derating_header(sheet_rows)
            if header is None:
                sheet_errors.append(f"{sheet_name}: 未找到包含“序号、型号规格、降额参数”的表头")
                continue

            header_idx, start_col = header
            data_start_idx = header_idx + 2 if has_derating_subheader(sheet_rows, header_idx + 1) else header_idx + 1
            records = extract_records(sheet_rows[data_start_idx:], start_col)
            if records:
                metadata = {
                    "sheet_name": sheet_name,
                    "header_row": sheet_rows[header_idx][0],
                    "data_start_row": sheet_rows[data_start_idx][0] if data_start_idx < len(sheet_rows) else None,
                    "start_column": start_col + 1,
                }
                return metadata, records
            sheet_errors.append(f"{sheet_name}: 未读取到有效数据行")

    detail = "；".join(sheet_errors)
    raise ValueError(f"未找到有效的降额设计分析表。{detail}")


def extract_records(rows: Iterable[tuple[int, list[str]]], start_col: int) -> list[dict[str, str]]:
    records = []
    fill_values = {col: "" for col in ["序号", "元器件名称", "型号规格", "生产厂商"]}
    for excel_row, row_values in rows:
        values = [row_values[idx] if idx < len(row_values) else "" for idx in range(start_col, start_col + len(INPUT_COLS))]
        if not any(str(value).strip() for value in values):
            continue

        record = {col: str(value).strip() for col, value in zip(INPUT_COLS, values)}
        for col in fill_values:
            if record[col]:
                fill_values[col] = record[col]
            else:
                record[col] = fill_values[col]

        record["序号"] = normalize_serial(record["序号"])
        if not record["降额参数"]:
            continue
        record["excel_row"] = str(excel_row)
        records.append(record)
    return records


def load_reference(data_path: Path) -> tuple[list[dict[str, str]], dict[tuple[str, str], list[dict[str, str]]]]:
    rows = json.loads(data_path.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise ValueError(f"JSON root must be a list: {data_path}")

    pair_rows: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if not isinstance(row, dict):
            continue
        category = str(row.get("元器件大类", "")).strip()
        subclass = str(row.get("元器件子类", "")).strip()
        if category and subclass:
            pair_rows[(category, subclass)].append(row)
    return rows, pair_rows


def classify_component(
    component_name: str,
    model: str,
    derating_params: Iterable[str],
    pair_rows: dict[tuple[str, str], list[dict[str, str]]],
) -> dict[str, object]:
    text = normalize_match_text(component_name, model, " ".join(derating_params))

    awg_match = re.search(r"awg\s*([0-9]{1,2})", text)
    if awg_match:
        key = ("导线与电缆", f"单根导线(AWG{awg_match.group(1)})")
        if key in pair_rows:
            return build_match(key, "high", f"名称或型号包含 AWG{awg_match.group(1)} 线规。", "keyword")

    for rule in RULES:
        if not re.search(rule["pattern"], text):
            continue
        key = (rule["category"], rule["subclass"])
        if key in pair_rows:
            return build_match(key, "high", rule["reason"], "keyword")

    key, score = best_fuzzy_pair(text, pair_rows.keys())
    if key is None:
        return {
            "matched": False,
            "元器件大类": "",
            "元器件子类": "",
            "confidence": "none",
            "match_method": "none",
            "selection_reason": "参考数据中没有可用的元器件分类。",
            "score": 0,
        }

    confidence = "medium" if score >= 0.45 else "low"
    return build_match(
        key,
        confidence,
        f"未命中明确关键词，按名称与参考分类文本相似度兜底匹配，score={score:.3f}。",
        "fuzzy",
        score,
    )


def build_match(
    key: tuple[str, str], confidence: str, reason: str, method: str, score: float | None = None
) -> dict[str, object]:
    result = {
        "matched": True,
        "元器件大类": key[0],
        "元器件子类": key[1],
        "confidence": confidence,
        "match_method": method,
        "selection_reason": reason,
    }
    if score is not None:
        result["score"] = round(score, 6)
    return result


def best_fuzzy_pair(
    text: str, keys: Iterable[tuple[str, str]]
) -> tuple[tuple[str, str] | None, float]:
    best_key = None
    best_score = -1.0
    text_chars = {ch for ch in text if ch.strip()}
    for key in keys:
        category, subclass = key
        candidate = normalize_match_text(category, subclass)
        if not candidate:
            continue
        seq_score = SequenceMatcher(None, text, candidate).ratio()
        candidate_chars = {ch for ch in candidate if ch.strip()}
        overlap = len(text_chars & candidate_chars) / max(len(text_chars | candidate_chars), 1)
        score = seq_score * 0.65 + overlap * 0.35
        category_text = normalize_match_text(category)
        subclass_text = normalize_match_text(subclass)
        if category_text and category_text in text:
            score += 0.15
        if subclass_text and subclass_text != "全类型" and subclass_text in text:
            score += 0.25
        if score > best_score:
            best_key = key
            best_score = score
    return best_key, max(best_score, 0.0)


def build_json_result(
    xlsx_path: Path,
    data_path: Path,
    sheet_metadata: dict[str, object],
    input_rows: list[dict[str, str]],
    pair_rows: dict[tuple[str, str], list[dict[str, str]]],
    include_reference: bool,
) -> dict[str, object]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    order = []
    for row in input_rows:
        name = row["元器件名称"]
        if name not in grouped:
            order.append(name)
        grouped[name].append(row)

    component_results: dict[str, dict[str, object]] = {}
    components = []
    for name in order:
        rows = grouped[name]
        models = [row["型号规格"] for row in rows if row["型号规格"]]
        params = sorted({row["降额参数"] for row in rows if row["降额参数"]})
        classification = classify_component(name, models[0] if models else "", params, pair_rows)
        key = (str(classification["元器件大类"]), str(classification["元器件子类"]))
        info = pair_rows.get(key, []) if classification.get("matched") else []
        component = {
            "元器件名称": name,
            "row_count": len(rows),
            "sample_models": sorted(set(models))[:5],
            "降额参数": params,
            **classification,
        }
        if include_reference:
            component["information"] = info
        components.append(component)
        component_results[name] = classification

    classified_rows = []
    for row in input_rows:
        classification = component_results[row["元器件名称"]]
        classified_rows.append({**row, **classification})

    class_counter = Counter(
        (row["元器件大类"], row["元器件子类"])
        for row in classified_rows
        if row.get("matched")
    )

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_xlsx": str(xlsx_path.resolve()),
        "source_json": str(data_path.resolve()),
        "sheet": sheet_metadata,
        "summary": {
            "total_rows": len(input_rows),
            "unique_component_names": len(components),
            "matched_component_names": sum(1 for item in components if item.get("matched")),
            "unmatched_component_names": sum(1 for item in components if not item.get("matched")),
            "classification_counts": [
                {"元器件大类": category, "元器件子类": subclass, "row_count": count}
                for (category, subclass), count in sorted(class_counter.items())
            ],
        },
        "components": components,
        "rows": classified_rows,
    }


def main() -> int:
    args = parse_args()
    xlsx_path = Path(args.xlsx)
    data_path = Path(args.data)
    if not xlsx_path.exists():
        raise SystemExit(f"XLSX file not found: {xlsx_path}")
    if not data_path.exists():
        raise SystemExit(f"JSON data file not found: {data_path}")

    sheet_metadata, input_rows = read_xlsx_derating_rows(xlsx_path)
    _, pair_rows = load_reference(data_path)
    result = build_json_result(
        xlsx_path=xlsx_path,
        data_path=data_path,
        sheet_metadata=sheet_metadata,
        input_rows=input_rows,
        pair_rows=pair_rows,
        include_reference=not args.no_reference,
    )

    output_path = Path(args.output) if args.output else Path(args.output_dir) / f"{xlsx_path.stem}_classification.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output_path)
    print(
        "rows={rows} unique_components={components} matched={matched}".format(
            rows=result["summary"]["total_rows"],
            components=result["summary"]["unique_component_names"],
            matched=result["summary"]["matched_component_names"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

---
name: component-derating-classifier
description: Classify electronic components and check Table 5 derating data. Use for component names, derating XLSX files, or existing derating JSON files. For XLSX input, generate an AI mapping, then run deterministic numeric checks with scripts/analyze_xlsx.py.
---

# Component Derating Classifier

Run commands from this skill directory unless the user gives another working directory. Use only the standards in `reference/jiange_full.json`; do not invent categories, subclasses, derating parameters, or derating values.

## Files

- `reference/jiange_full.json`: allowed component categories, subclasses, standard derating parameters, and derating factors.
- `reference/rules.md`: derating check rules.
- `scripts/xlsx_to_json.py`: converts Table 5 XLSX files to JSON.
- `scripts/analyze_xlsx.py`: applies an AI mapping and performs deterministic numeric checks.
- `scripts/write_selected_subclass.py`: writes reference rows for one selected subclass.

## Route

- `.xlsx` path: use the Excel workflow.
- Existing derating `.json`: generate or reuse an AI mapping, then run/check deterministically where possible.
- One component record or component name/model/derating parameter: use the single-component workflow.

## Excel Workflow

### 1. Convert The Table

```bash
python scripts/xlsx_to_json.py "input.xlsx" -o outputs/input_table.json
```

Expected Table 5 shape:

- row 1: title
- rows 2-3: two-level headers
- row 4 onward: data

Important normalized fields:

- `元器件名称`
- `型号规格_规格`
- `降额参数`
- `参数值_额定`
- `参数值_允许`
- `参数值_实际`
- `降额因子_规定`
- `降额因子_实际`
- `降额等级`

The converter fills down merged/blank identity columns (`序号`, `元器件名称`, `型号规格_规格`, `生产厂商_生产单位`) so multiple derating-parameter rows for the same component stay attached to that component.

### 2. Single Component Decision Contract

For every component record, use this decision contract:

1. Use the component name, model/specification, and submitted derating parameter to decide which standard `元器件大类` and `元器件子类` the component belongs to.
2. In `reference/jiange_full.json`, find the standard derating parameter entry that best matches the submitted derating parameter. Return the standard derating parameter name and copy its `I级降额` value verbatim.
3. If multiple entries could match, choose the closest semantic match.
4. If the standard has no matching category, subclass, or parameter, set `大类` and `子类` to `未找到`, and set `I级额定降额值` to `N/A`.

Additional classification rules:

- Treat AD converters, A/D converters, ADC, analog-to-digital converters, DA converters, D/A converters, DAC, and digital-to-analog converters as `集成电路 / 混合集成电路`.
- Treat `熔断器` as `保险丝`.

For a single-component request, return exactly this JSON object and nothing else:

```json
{
  "大类": "standard component category name",
  "子类": "standard component subclass name",
  "标准降额参数": "matched standard derating parameter name",
  "I级额定降额值": "matched I-level derating value"
}
```

### 3. Generate The Batch AI Mapping

For an XLSX workflow, apply the same decision contract to each unique component and submitted derating parameter, then write `outputs/input_ai_mapping.json`:

```json
{
  "schema_version": "1.0",
  "components": [
    {
      "元器件名称": "瓷介电容器",
      "元器件大类": "电容器",
      "元器件子类": "固定陶瓷电容器"
    }
  ],
  "parameter_matches": [
    {
      "元器件名称": "瓷介电容器",
      "降额参数": "工作电压",
      "标准参数": "直流工作电压"
    }
  ]
}
```

AI mapping rules:

- Keep every `元器件名称` exactly as it appears in `outputs/input_table.json`.
- Prefer the most specific valid subclass implied by component name, model/specification, function, load type, and derating parameter.
- Use `全类型` only when it is the best valid subclass for a broad component.
- When reading standard rows, treat `元器件大类 + 元器件子类` as the component type key. Do not match rows by `元器件子类` alone because subclasses such as `全类型` appear under multiple categories.
- Match parameters by meaning, not exact text only. For example, `工作电压` may map to `直流工作电压`, `电源电压`, or `输入电压` depending on the selected subclass.
- Omit uncertain `parameter_matches`; the deterministic checker will mark those rows for review.
- Do not include explanation fields such as `confidence`, `match_method`, or `selection_reason` in the mapping file.

### 4. Run Deterministic Checks

```bash
python scripts/analyze_xlsx.py "input.xlsx" --ai-mapping outputs/input_ai_mapping.json
```

The script writes:

- `outputs/input_table.json`
- `outputs/input_classification.json`
- `outputs/input_component_decisions.json`
- `outputs/input_check_result.json`

The checker handles:

- I-level derating check
- required derating factor vs. standard factor
- `allowed value = rated value * required derating factor`
- `actual value <= allowed value`
- `actual derating factor <= required derating factor`
- temperature-related actual value must not exceed `85 deg C`
- summary and row-level issue output

## Single-Component Workflow

Use this when the input is one component name, or one component name plus model/specification and derating parameter.

1. List valid category/subclass pairs:

```bash
python - <<'PY'
import json
rows=json.load(open("reference/jiange_full.json", encoding="utf-8-sig"))
for item in sorted({(r["元器件大类"], r["元器件子类"]) for r in rows if r.get("元器件大类") and r.get("元器件子类")}):
    print(f"{item[0]} / {item[1]}")
PY
```

2. Apply the `Single Component Decision Contract`.

3. If the user asks for the strict classification result, return only:

```json
{
  "大类": "standard component category name",
  "子类": "standard component subclass name",
  "标准降额参数": "matched standard derating parameter name",
  "I级额定降额值": "matched I-level derating value"
}
```

4. If the user asks for reference rows for the selected subclass, write them:

```bash
python scripts/write_selected_subclass.py \
  --component-name "用户输入的元器件名称" \
  --category "选择的元器件大类" \
  --subclass "选择的元器件子类" \
  --reason "简短说明为什么选择该子类" \
  --output component_derating_result.json
```

## Reporting

For XLSX analysis, report:

- `*_table.json`
- `*_ai_mapping.json`
- `*_classification.json`
- `*_component_decisions.json`
- `*_check_result.json`
- final summary counts from `*_check_result.json`
- any unmatched components or omitted parameter matches that require review

For single-component classification, return the strict JSON object when requested. Otherwise, report the selected `元器件大类`, selected `元器件子类`, matched `标准降额参数`, and `I级额定降额值`.

---
name: component-derating-classifier
description: Classify electronic components and check Table 5 derating data. Use for component names, derating XLSX files, or existing derating JSON files. For XLSX input, generate an AI mapping, then run deterministic numeric checks with scripts/analyze_xlsx.py.
---

# Component Derating Classifier

Run commands from this skill directory unless the user gives another working directory.

## Files

- `reference/jiange_full.json`: allowed component categories, subclasses, standard derating parameters, and derating factors.
- `reference/rules.md`: derating check rules.
- `scripts/xlsx_to_json.py`: converts Table 5 XLSX files to JSON.
- `scripts/analyze_xlsx.py`: applies an AI mapping and performs deterministic numeric checks.
- `scripts/write_selected_subclass.py`: writes reference rows for one selected subclass.

## Route

- `.xlsx` path: use the Excel workflow.
- Existing derating `.json`: generate or reuse an AI mapping, then run/check deterministically where possible.
- Component name only: use the single-component workflow.

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

### 2. Generate The AI Mapping

Read `outputs/input_table.json` and `reference/jiange_full.json`. For each unique component name, choose exactly one valid `元器件子类`. For each submitted `降额参数`, choose the matching standard `降额参数` for that selected subclass.

Write `outputs/input_ai_mapping.json`:

```json
{
  "schema_version": "1.0",
  "components": [
    {
      "元器件名称": "瓷介电容器",
      "元器件大类": "电容器",
      "元器件子类": "固定陶瓷电容器",
      "confidence": "high",
      "match_method": "ai",
      "selection_reason": "名称包含瓷介电容器。"
    }
  ],
  "parameter_matches": [
    {
      "元器件名称": "瓷介电容器",
      "降额参数": "工作电压",
      "标准参数": "直流工作电压",
      "selection_reason": "电容工作电压对应直流工作电压。"
    }
  ]
}
```

AI mapping rules:

- Do not invent categories, subclasses, or standard parameters.
- Prefer the most specific subclass implied by component name, model, function, or load type.
- Use `全类型` only when it is the best valid subclass for a broad component.
- Match parameters by meaning, not exact text only. For example, `工作电压` may map to `直流工作电压`, `电源电压`, or `输入电压` depending on the subclass.
- Omit uncertain parameter matches; the checker will mark them for review.

### 3. Run Deterministic Checks

```bash
python scripts/analyze_xlsx.py "input.xlsx" --ai-mapping outputs/input_ai_mapping.json
```

The script writes:

- `outputs/input_table.json`
- `outputs/input_classification.json`
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

Use this when the input is only a component name.

1. List valid subclasses:

```bash
rg -o '"元器件子类": "[^"]+"' reference/jiange_full.json \
  | sed 's/^.*"元器件子类": "//; s/"$//' \
  | sort -u
```

2. Choose exactly one valid subclass using the same AI mapping rules above.

3. Write the selected subclass reference rows:

```bash
python scripts/write_selected_subclass.py \
  --component-name "用户输入的元器件名称" \
  --subclass "选择的元器件子类" \
  --reason "简短说明为什么选择该子类" \
  --output component_derating_result.json
```

## Reporting

For XLSX analysis, report:

- `*_table.json`
- `*_ai_mapping.json`
- `*_classification.json`
- `*_check_result.json`
- final summary counts from `*_check_result.json`
- any unmatched components or omitted parameter matches that require review

For single-component classification, report the output JSON path, selected `元器件大类`, selected `元器件子类`, and reason.

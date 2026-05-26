---
name: component-derating-classifier
description: Use this skill when a user provides either an electronic component name or a derating Excel path. For a component name, compare it with unique 元器件子类 values from reference/jiange_full.json and write one subclass result. For an Excel path, parse each 元器件名称, match subclasses, write a classification JSON, run the jiange_agent.py validation logic, and write a final JSON result.
---

# Component Derating Classifier

## Data Source

Use this JSON data source:

`reference/jiange_full.json`

Run commands from the skill root directory unless a user explicitly provides another working directory.

## Required Workflow

If the user input is a file path ending in `.xlsx`, use the Excel workflow. Otherwise use the single-component workflow.

## Excel Workflow

Use this when the user provides an Excel input path such as `inputs_data/00_inputs/降额test1.xlsx`.

Run from the skill root:

```bash
python scripts/process_input_xlsx.py "输入文件.xlsx" --output-dir outputs
```

The script:

- parses each row in the derating Excel table and extracts `元器件名称`
- matches each component to one `元器件大类 / 元器件子类`
- writes `*_classification.json`
- uses `scripts/jiange_agent.py` rule-checking logic to validate derating values
- writes `*_jiange_result.json`

`scripts/process_input_xlsx.py` can read simple `.xlsx` files even when `openpyxl` is unavailable, via the XML fallback in `scripts/jiange_agent.py`.

Always report both JSON paths and the summary in the final result JSON.

## Single-Component Workflow

Do not use a script to judge the component category. Judge directly from the user's component name and the unique subclass list extracted from JSON.

### Step 1: Extract Unique Subclasses

Run `rg` against the JSON data source to list all `元器件子类` values, then deduplicate them:

```bash
rg -o '"元器件子类": "[^"]+"' reference/jiange_full.json \
  | sed 's/^.*"元器件子类": "//; s/"$//' \
  | sort -u
```

### Step 2: Choose One Subclass

Compare the user's component name with the extracted subclass names and choose exactly one most similar `元器件子类`.

Selection rules:

- Final output must contain only one result. Do not output multiple candidates.
- Prefer the most specific subclass implied by the component name, part number, function, or load type.
- If the input is broad and a matching `全类型` subclass exists, choose `全类型`.
- If the input is broad and no `全类型` exists, still choose the closest single subclass and note the uncertainty in `selection_reason`.
- Do not invent subclasses. The selected subclass must appear in the Step 1 output.

After selecting the subclass, find its 大类 from the JSON:

```bash
SELECTED_SUBCLASS='模拟电路-放大器'
rg -n -C 2 "\"元器件子类\": \"$SELECTED_SUBCLASS\"" reference/jiange_full.json
```

### Step 3: Write The Selected Subclass Information

Write a JSON file containing all rows whose `元器件子类` equals the selected subclass. The output must contain one selected subclass result only.

Use `scripts/write_selected_subclass.py` after Step 2 has already selected the subclass. This script only writes the selected subclass information; it does not classify or choose the subclass.

```bash
python scripts/write_selected_subclass.py \
  --component-name "用户输入的元器件名称" \
  --subclass "选择的元器件子类" \
  --reason "简短说明为什么该子类最相似" \
  --output component_derating_result.json
```

## Output Schema

The final UTF-8 JSON must contain one `result` object:

```json
{
  "schema_version": "3.0",
  "input": "用户输入的元器件名称",
  "source_json": "reference/jiange_full.json",
  "matched": true,
  "result": {
    "元器件大类": "集成电路",
    "元器件子类": "模拟电路-放大器",
    "selection_reason": "运放通常对应放大器类模拟电路。",
    "information": []
  }
}
```

## Examples

- `LM358 运放` -> `模拟电路-放大器`
- `LM393 比较器` -> `模拟电路-比较器`
- `钽电容` -> `钽电解电容器`
- `AWG22 导线` -> `单根导线(AWG22)`
- `连接器` -> `全类型`

Always report the output JSON path and the one selected subclass. Also report the 大类 found from the selected rows.

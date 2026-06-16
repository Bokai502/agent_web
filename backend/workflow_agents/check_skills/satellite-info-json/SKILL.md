---
name: satellite-info-json
description: "Extract satellite mission information into JSON. Use with an active workspace: read input_config.json, use only input_files.requirement_document, and output satellite_info-compatible items for orbit/lifetime/inclination, radiation requirements, quality grade requirements, and assurance/screening/low-grade/first-flight requirements."
---

# Satellite Info JSON

Use the active version `workspace_dir`; never use repository, template, prior
version, or manifest-root files.

## Input

Read:

```text
<workspace_dir>/00_inputs/input_config.json
```

Use only `input_files.requirement_document.relative_path` as the requirement
document path, resolved relative to `<workspace_dir>/00_inputs`. Do not use a
default or inferred document. If the config, path, or file is missing, report it
and stop.

## Extract

Create exactly these four satellite information items from text explicitly
present in the requirement document:

1. 轨道/寿命/倾角
2. 抗辐照要求
3. 质量等级要求
4. 质保/补筛/低等级/首飞

Do not invent values, thresholds, categories, or conclusions. If an item is not
found, keep the item and use `未检索到明确描述` as evidence.

## Output

Write:

```text
<workspace_dir>/check_outputs/compliance/stages/satellite_info.json
```

Use this exact JSON shape:

```json
{
  "stage": "satellite_info",
  "output": [
    {
      "item": "轨道/寿命/倾角",
      "evidence": "",
      "info_source": "requirement_document"
    },
    {
      "item": "抗辐照要求",
      "evidence": "",
      "info_source": "requirement_document"
    },
    {
      "item": "质量等级要求",
      "evidence": "",
      "info_source": "requirement_document"
    },
    {
      "item": "质保/补筛/低等级/首飞",
      "evidence": "",
      "info_source": "requirement_document"
    }
  ]
}
```

Keep `item` names exactly as shown. Use concise Chinese evidence, preserving
important original numbers, units, grade codes, and thresholds. Report the
output path and any item whose evidence is `未检索到明确描述`.

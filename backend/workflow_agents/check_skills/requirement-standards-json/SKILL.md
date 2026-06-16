---
name: requirement-standards-json
description: "Extract requirement-standard check items into JSON. Use with an active workspace: read input_config.json, use only input_files.requirement_document, and output five check items for component classification, key components, domestic quality grade, selection principles, and flight heritage."
---

# Requirement Standards JSON

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

Create exactly five check items from text explicitly present in the requirement
document:

1. 元器件分类定义标准
2. 关键器件划分标准
3. 国产元器件质量等级要求
4. 元器件选用基本原则
5. 元器件飞行经历选用要求

Do not invent thresholds, categories, conclusions, or citations.

## Output

Write:

```text
<workspace_dir>/check_outputs/compliance/stages/requirements_analysis.json
```

Use this exact JSON shape:

```json
{
  "source_file": "<input_files.requirement_document.relative_path>",
  "check_items": [
    {
      "name": "元器件分类定义标准",
      "original_content": null,
      "interpretation": null,
      "judgment_basis": null
    },
    {
      "name": "关键器件划分标准",
      "original_content": null,
      "interpretation": null,
      "judgment_basis": null
    },
    {
      "name": "国产元器件质量等级要求",
      "original_content": null,
      "interpretation": null,
      "judgment_basis": null
    },
    {
      "name": "元器件选用基本原则",
      "original_content": null,
      "interpretation": null,
      "judgment_basis": null
    },
    {
      "name": "元器件飞行经历选用要求",
      "original_content": null,
      "interpretation": null,
      "judgment_basis": null
    }
  ]
}
```

For each item:

- `original_content`: 需求文档原文引用
- `interpretation`: 原文解读
- `judgment_basis`: 判断依据

If an item is not found, keep the item and set those three fields to `null`.
Report the output path and any missing items.

---
name: compliance
description: Run the SatLab aerospace component compliance workflow. Use for requirement documents and component BOM/list inputs to classify components, check key units, quality level, manufacturer/catalog status, flight history, reliability evidence, and generate a compliance report. Delegate derating checks to component-derating-classifier.
---

# Compliance

Use the Open Codex Web execution context `workspace_dir` as the workspace root.
Run commands from this skill directory and write generated files under the
workspace.

The default user input directory is `<workspace_dir>/00_inputs`. If the user
provides explicit paths, use those instead.

## Inputs

Expected inputs can be supplied as explicit paths or discovered from
`<workspace_dir>/00_inputs`:

- Requirement document: Markdown or text converted from the mission requirement document. Common names include `需求文档*.md`, `requirement*.md`, or `requirements*.txt`.
- Component list: XLSX, CSV, or JSON BOM/list containing at least model, name, manufacturer, and package fields. Common examples include `test_48.xlsx` or a file with `元器件`, `component`, `bom`, or `list` in the name.
- Optional catalog evidence: XLSX, CSV, or JSON for local catalog matching. If absent, the pipeline defaults to PostgreSQL catalog lookup.
- Optional reliability evidence: XLSX, CSV, or JSON. If absent, use file mode with no reliability rows, or PostgreSQL mode when requested.
- Optional `compliance_config.json`: user confirmations and external check results replacing the original frontend confirmation step.

Supported component-list column aliases include:

- model: `型号规格`, `型号`, `器件型号`, `元器件型号`, `component_model`, `model`
- name: `元器件名称`, `名称`, `器件名称`, `component_name`, `name`
- manufacturer: `生产厂商`, `厂商`, `制造商`, `manufacturer_name`, `manufacturer`
- package: `封装形式`, `封装`, `package_type`
- optional quality, temperature, flight history, key-part, and low-quality columns.

## Quick Start

From this skill directory:

```bash
PYTHONPATH=scripts python -m compliance \
  --requirement-doc <workspace_dir>/00_inputs/需求文档_1.pdf.md \
  --component-list <workspace_dir>/00_inputs/test_48.xlsx \
  --output-dir <workspace_dir>/check_outputs/compliance \
  --workspace-dir <workspace_dir> \
  --catalog-source file \
  --reliability-source file
```

If local catalog evidence is not provided and PostgreSQL catalog access is
available, omit `--catalog-source file` so the default PostgreSQL catalog lookup
is used. If reliability database access is requested, pass
`--reliability-source postgres` and the PostgreSQL options or environment
variables listed below.

## Configuration

LLM settings default to the app root `config.json` `chatModel`. Database
settings default to `config.json` `compliance.database`. CLI flags and
environment variables still override those defaults.

## Derating Delegation

This skill is the compliance coordinator. It must not perform derating
classification or derating numeric checks directly when a derating table is
present.

When a derating XLSX/JSON is available, spawn one sub-agent using
`$component-derating-classifier` to complete the derating workflow. Give the
sub-agent the active `workspace_dir`, the derating input path under
`<workspace_dir>/00_inputs`, and ask it to write JSON artifacts under
`<workspace_dir>/check_outputs/component-derating-classifier/`.

Expected sub-agent artifacts:

- `*_check_result.json`
- `*_classification.json`
- `*_component_decisions.json`
- `*_mapping_completeness.json` when an AI mapping is produced

After the sub-agent finishes, include its JSON outputs in the final compliance
handoff/report context. Do not overwrite or recalculate derating conclusions in
compliance. If the sub-agent cannot run, record the blockage and state that the
derating result is unavailable rather than falling back to a simplified local
calculation.

## Progress

Keep progress in `<workspace_dir>/logs/progress.json` with schema
`loop_progress/1.0`. Use these loop names:

- `check_compliance_load_inputs`
- `check_compliance_analysis`
- `check_compliance_classification`
- `check_compliance_checks`
- `check_compliance_report`

The compliance CLI updates these loops automatically when `--workspace-dir` is
provided or when it can infer the workspace from
`<workspace_dir>/check_outputs/compliance`. Manual updates are only needed for
external delegated work or recovery:

```bash
python scripts/progress_update.py \
  --workspace-dir <workspace_dir> \
  --loop-name check_compliance_analysis \
  --status analysis_running \
  --completed false \
  --percentage 20
```

After the stage or group finishes, mark the same loop complete:

```bash
python scripts/progress_update.py \
  --workspace-dir <workspace_dir> \
  --loop-name check_compliance_analysis \
  --status analysis_completed \
  --completed true \
  --percentage 100
```

Suggested mapping:

- `load_inputs`: `check_compliance_load_inputs`
- `requirements_analysis` and `satellite_info`: `check_compliance_analysis`
- `component_classification`: `check_compliance_classification`
- `manufacturer_check`, `key_units_check`, `flight_history_check`, `catalog_match`, `quality_level_check`, and `reliability_query`: `check_compliance_checks`
- `report_generation`: `check_compliance_report`

## Config Template

When the workflow needs fixed confirmations before a full run, generate a config
template, edit or patch the selected values, then pass it to the pipeline:

```bash
PYTHONPATH=scripts python -m compliance.config_template \
  --component-list <component-list.xlsx> \
  --output <workspace_dir>/check_outputs/compliance/compliance_config.json
```

The config can override component classifications, manufacturer confirmations,
quality thresholds, key-unit selections, and external catalog/quality/
reliability results.

## Stages

The pipeline supports `--stage`:

- `all`: run all stages.
- `analysis`: load inputs, analyze requirements/satellite info, classify components, and normalize manufacturers.
- `checks`: run deterministic/evidence checks without final report generation.
- `report`: run all stages and write the report.
- A single stage name: run prerequisites through that stage.
- `from:<stage>`: run from that stage to the end.

Stage names:

```text
load_inputs
requirements_analysis
satellite_info
component_classification
manufacturer_check
key_units_check
flight_history_check
catalog_match
quality_level_check
reliability_query
report_generation
```

## Output

The pipeline writes:

- `<output-dir>/manifest.json`
- `<output-dir>/steps/<stage>.json` for each executed stage
- `<output-dir>/steps/<artifact>.json` for artifacts not already written as stages
- `<output-dir>/compliance_report.md` after `report_generation`

Report the output directory, manifest path, executed stages, and whether the
final report was generated. If a database source is unavailable, the pipeline may
continue with a fallback artifact; surface that issue to the user.

## Workflow Guidance

1. Identify or ask for the requirement document and component list if they cannot
   be discovered safely from `<workspace_dir>/00_inputs`.
2. Prefer writing to `<workspace_dir>/check_outputs/compliance`.
3. Use local file sources when database access is not available.
4. Use `--stage checks` for a quick validation pass and `--stage all` or
   `--stage report` when the user needs the final Markdown report.
5. Keep generated artifacts in the workspace, not in this skill directory.

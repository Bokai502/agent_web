# Compliance Runner

This workflow intentionally has no central pipeline. The model or operator
chooses and runs each stage explicitly with `compliance.runner`.

Run commands from the active version workspace directory, and use the compliance
skill's absolute `scripts` path for `PYTHONPATH`. This keeps writes inside the
version workspace when the broader `/data` tree is read-only in the sandbox:

```bash
cd <workspace_dir>
export PYTHONPATH=<skill_dir>/scripts
```

`<workspace_dir>` must be the active version workspace directory. For versioned
work, use `<workspace_manifest_root>/versions/<versionId>` rather than
`<workspace_manifest_root>`. If you have only `workspaceId` and `versionId`,
resolve them through the Versioning/manifest context before invoking the
runner.

Resolve inputs first:

```bash
python -m compliance.input_config --workspace-dir <workspace_dir>
```

Use this output directory unless the user explicitly chooses another one:

```text
<workspace_dir>/check_outputs/compliance
```

Do not use `<workspace_manifest_root>/check_outputs/compliance`; that writes
outside the selected version and can make the frontend read stale or missing
tables.

## Command Form

Run one stage at a time:

```bash
cd <workspace_dir>
python -m compliance.runner \
  --stage <stage_name> \
  --workspace-dir <workspace_dir> \
  --config <workspace_dir>/00_inputs/input_config.json
```

`python -m compliance` is an alias for `python -m compliance.runner`.

The default output directory is `<workspace_dir>/check_outputs/compliance`,
where `<workspace_dir>` is the concrete version directory. Avoid passing
`--output-dir` for normal workflow runs. If a custom output directory is
provided, it must be inside `workspace_dir`; paths outside the current version
workspace are ignored and replaced by the default output directory.

The runner writes:

```text
<output-dir>/stages/<stage_name>.json
<output-dir>/manifest.json
```

`report_generation` additionally writes:

```text
<output-dir>/compliance_report.md
```

## Recommended Order

Run these stages in order for a full review:

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
derating_check
reliability_query
report_generation
```

## Stage Notes

- `load_inputs` reads the requirement document and component list from
  `input_config.json` unless command-line paths override them.
- `requirements_analysis` also writes `stages/satellite_info.json` as a helper
  artifact when it asks the LLM for combined requirement/satellite analysis.
- `component_classification` also writes `stages/category_summary.json`.
- `catalog_match` reads `input_config.json` `catalog_match.threshold` as the
  catalog-in similarity threshold. The value must be between 0 and 1; invalid
  or missing values fall back to `0.72`.
- `derating_check` uses `input_config.json` `derating_table` and
  `derating_standard` when present. If no valid standard JSON is configured, it
  uses `reference/jiange_full.json`.
- `report_generation` expects prior step JSON files. If a report lacks a
  section, run the missing stage and rerun `report_generation`.

## Common Groups

For analysis-only work, run:

```text
load_inputs
requirements_analysis
satellite_info
component_classification
manufacturer_check
```

For checks without final report generation, run:

```text
load_inputs
component_classification
manufacturer_check
key_units_check
flight_history_check
catalog_match
quality_level_check
derating_check
reliability_query
```

For report-only recovery, ensure the needed `stages/*.json` files exist, then
run:

```text
report_generation
```

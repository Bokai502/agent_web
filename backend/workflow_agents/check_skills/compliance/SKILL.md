---
name: compliance
description: Run the SatLab aerospace component compliance workflow. Use for requirement documents and component BOM/list inputs to classify components, check key units, quality level, manufacturer/catalog status, flight history, derating, reliability evidence, and generate a compliance report.
---

# Compliance

Use the Open Codex Web execution context `workspace_dir` as the workspace root.
Run commands from this skill directory and write generated files under the
workspace.

The authoritative input manifest is
`<workspace_dir>/00_inputs/input_config.json`. Read requirement/component paths
and quality-check settings from that file before running any compliance stage.
Use explicit user-provided paths only when the user directly overrides
`input_config.json`.

## Inputs

Read `<workspace_dir>/00_inputs/input_config.json` first. Use
`input_files.requirement_document` and `input_files.component_list` as required
inputs. Use optional `catalog`/`catalog_evidence`, `reliability_db`/
`reliability_evidence`, `derating_table`, and `derating_standard` when present.

Use the same config for quality settings. The runner reads
`quality_level.min_required`; if it is absent, use `quality_level.selected` or
`compliance_config.quality_level.min_required`.

## Configuration

LLM settings default to the app root `config.json` `chatModel`. Database
settings default to `config.json` `compliance.database`. CLI flags and
environment variables still override those defaults.

## Workflow

From this skill directory:

### Resolve

```bash
PYTHONPATH=scripts python -m compliance.input_config \
  --workspace-dir <workspace_dir>
```

### Run

There is no central pipeline. Follow `reference/runner.md` and run each stage
explicitly. `derating_check` uses the local
`scripts/compliance/derating` implementation when `input_config.json` contains
`derating_table`.

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

Command form:

```bash
PYTHONPATH=scripts python -m compliance.runner \
  --stage <stage_name> \
  --output-dir <workspace_dir>/check_outputs/compliance \
  --workspace-dir <workspace_dir> \
  --config <workspace_dir>/00_inputs/input_config.json
```

`python -m compliance` is an alias for `python -m compliance.runner`.

## Stages

The runner supports one `--stage` value per command. The model/operator chooses
the order from `reference/runner.md`.

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
derating_check
reliability_query
report_generation
```

## Output

The runner writes:

- `<output-dir>/manifest.json`
- `<output-dir>/stages/<stage>.json` for each executed stage
- `<output-dir>/stages/<artifact>.json` for helper artifacts written by stages
- `<output-dir>/derating/` for derating table, classification, decision, and check-result details
- `<output-dir>/compliance_report.md` after `report_generation`

Report the output directory, manifest path, executed stages, and whether the
final report was generated. If a database source is unavailable, the runner may
continue with a fallback artifact; surface that issue to the user.

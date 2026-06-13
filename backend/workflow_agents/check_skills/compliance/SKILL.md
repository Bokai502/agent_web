---
name: compliance
description: Run the SatLab aerospace component compliance workflow. Use for requirement documents and component BOM/list inputs to classify components, check key units, quality level, manufacturer/catalog status, flight history, derating, reliability evidence, and generate a compliance report.
---

# Compliance

Use the Open Codex Web execution context `workspace_dir` as the active version
workspace root. In versioned work this must be the concrete version directory,
for example `<workspace_manifest_root>/versions/v0001`, not the workspace
manifest root itself. If the UI/API provides `workspaceId` plus `versionId`,
resolve that pair to the matching `versions/<versionId>` directory before
running commands. Do not reuse output paths from prior turns, other versions,
the repository checkout, or template input directories.

The authoritative input manifest is
`<workspace_dir>/00_inputs/input_config.json`. Read requirement/component paths
and quality-check settings from that file before running any compliance stage.
Use explicit user-provided paths only when the user directly overrides
`input_config.json`.

Path sanity check before running:

```bash
test -f <workspace_dir>/00_inputs/input_config.json
test "$(basename "$(dirname "<workspace_dir>")")" = "versions"
```

## Inputs

Read `<workspace_dir>/00_inputs/input_config.json` first. Use
`input_files.requirement_document` and `input_files.component_list` as required
inputs. Use optional `catalog`/`catalog_evidence`, `reliability_db`/
`reliability_evidence`, `derating_table`, and `derating_standard` when present.

Use the same config for quality settings. The runner reads
`quality_level.min_required`; if it is absent, use `quality_level.selected` or
`compliance_config.quality_level.min_required`.

Use `catalog_match.threshold` in `input_config.json` for the catalog match
similarity threshold. The value is a number from 0 to 1; if absent or invalid,
the runner uses `0.72`.

## Configuration

LLM settings default to the app root `config.json` `chatModel`. Database
settings default to `config.json` `compliance.database`. CLI flags and
environment variables still override those defaults.

## Workflow

Run commands from the active version workspace directory, using the skill's
absolute `scripts` path for `PYTHONPATH`. This keeps the process working
directory inside the writable workspace bind mount when the surrounding `/data`
tree is mounted read-only by the Codex sandbox.

### Resolve

```bash
cd <workspace_dir>
PYTHONPATH=<skill_dir>/scripts python -m compliance.input_config \
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
cd <workspace_dir>
PYTHONPATH=<skill_dir>/scripts python -m compliance.runner \
  --stage <stage_name> \
  --workspace-dir <workspace_dir> \
  --config <workspace_dir>/00_inputs/input_config.json
```

`python -m compliance` is an alias for `python -m compliance.runner`.

Omit `--output-dir` unless the user explicitly asks for a workspace-local
subdirectory. The runner defaults to `<workspace_dir>/check_outputs/compliance`,
where `<workspace_dir>` is the active version directory. Never write outputs
under the workspace manifest root such as `<workspace_manifest_root>/check_outputs`;
outputs belong under `<workspace_manifest_root>/versions/<versionId>/check_outputs`.
The runner ignores any output directory outside `workspace_dir` to stay within
the versioned workspace write boundary.

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

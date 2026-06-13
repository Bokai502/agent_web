# FreeCAD: CAD Validate Workflow

Validate the CAD-stage bundle in the Open Codex Web execution-context workspace. The CLI entry point
is `python -m freecad_cli_tools.cli.main cad validate`.

Use this workflow when the user asks whether a CAD build is correct, wants
geometry validation, collision/overlap checks,贴面安装 checks, face occupancy
checks, screenshot capture, or wants validation results written into
`01_cad/cad_agent_output.json`.

## Core Rules

- Resolve the workspace from the Open Codex Web execution context
  `workspace_dir`. Workspace/version selection is request-scoped; `/api/run`,
  checkout, and branch do not update `project root config.json`.
- Always pass the execution context workspace explicitly with
  `--workspace-dir <workspace_dir>` for `config show`, `cad validate`, and any
  progress updates. Do not rely on `config.json`, process `cwd`, or CLI
  defaults during Open Codex Web runs.
- `project root config.json` field `workspace.templateDir`,
  `FREECAD_WORKSPACE_DIR`, and `WORKSPACE_DIR` are fallback mechanisms only for
  non-Web/manual CLI use.
- Default validation inputs are `<workspace>/00_inputs` and
  `<workspace>/01_cad`.
- The validation report is merged into
  `./01_cad/cad_agent_output.json` under the `validation` key.
- Screenshot metadata is written only to the top-level `screenshot` key in
  `cad_agent_output.json`; do not duplicate it inside `validation`.
- By default the command captures six FreeCAD views through RPC.

## Command Pattern

```bash
python -m freecad_cli_tools.cli.main config show \
  --workspace-dir <workspace_dir>
```

```bash
python -m freecad_cli_tools.cli.main cad validate \
  --workspace-dir <workspace_dir>
```

Use `--strict` only when the caller wants a nonzero exit status for hard
validation failures. Geometry quality warnings do not make `--strict` fail
when `validation.success == true`. Use `--no-screenshot` only when screenshot
capture should be skipped.

## Checks

The validator checks:

- required `01_cad` artifacts exist as hard failures
- input/output ID contracts match as hard failures
- CAD-stage output contracts such as `simulation_input.json` as hard failures
- component bounding-box overlaps as warnings
- mount-plane contact as warnings
- footprint bounds on install faces as warnings
- face occupancy ratio against `--max-occupancy-ratio` as warnings

## Screenshot Outputs

By default these files are written under `<workspace>/01_cad`:

- `freecad_screenshot_top.png`
- `freecad_screenshot_bottom.png`
- `freecad_screenshot_front.png`
- `freecad_screenshot_back.png`
- `freecad_screenshot_left.png`
- `freecad_screenshot_right.png`

The top-level `cad_agent_output.json["screenshot"]` field records the image
paths and capture metadata.

## Output Fields To Check

- `success`
- `status`
- `validation.success`
- `validation.errors`
- `validation.warnings`
- `validation.checks`
- `screenshot`
- `progress_percentages`
- `progress_json_path`
- progress log `output_files`

## Reporting Template

Report validation in this order:

1. State whether validation passed, passed with warnings, or failed.
2. If failed, list blocking hard errors first, especially missing artifacts or
   broken ID/output contracts.
3. List geometry quality warnings such as overlaps, mount contact, footprint,
   or occupancy issues as non-blocking warnings when `validation.success == true`.
4. State where `cad_agent_output.json` was updated.
5. State screenshot paths when screenshots were captured.
6. State `progress_json_path` and the three progress percentages.
7. If non-blocking geometry warnings are present, ask the user whether they
   want to modify the CAD/layout to resolve those warnings.
8. If `--strict` was not used, remember that the CLI process can exit
   successfully while the report contains `validation.success=false`.

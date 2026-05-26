# FreeCAD: CAD Validate Workflow

Validate the CAD-stage bundle in the configured workspace. The CLI entry point
is `python -m freecad_cli_tools.cli.main cad validate`.

Use this workflow when the user asks whether a CAD build is correct, wants
geometry validation, collision/overlap checks,贴面安装 checks, face occupancy
checks, screenshot capture, or wants validation results written into
`01_cad/cad_agent_output.json`.

## Core Rules

- Use `python -m freecad_cli_tools.cli.main config show` first to inspect the configured workspace,
  default inputs, CAD output directory, and RPC host/port.
- The workspace source of truth is `/data/lbk/codex_web/config.json` field
  `freecad.workspaceDir`. Deprecated `--workspace`, `FREECAD_WORKSPACE_DIR`,
  and `WORKSPACE_DIR` values must not be used to switch datasets.
- Default validation inputs are `./00_inputs` and `./01_cad` under the
  configured workspace.
- The validation report is merged into
  `./01_cad/cad_agent_output.json` under the `validation` key.
- Screenshot metadata is written only to the top-level `screenshot` key in
  `cad_agent_output.json`; do not duplicate it inside `validation`.
- By default the command captures six FreeCAD views through RPC.

## Command Pattern

```bash
python -m freecad_cli_tools.cli.main config show
```

```bash
python -m freecad_cli_tools.cli.main cad validate
```

Use `--strict` only when the caller wants a nonzero exit status for validation
failures. Use `--no-screenshot` only when screenshot capture should be skipped.

## Checks

The validator checks:

- required `01_cad` artifacts exist
- input/output ID contracts match
- component bounding-box overlaps
- mount-plane contact
- footprint bounds on install faces
- face occupancy ratio against `--max-occupancy-ratio`
- CAD-stage output contracts such as `simulation_input.json`

## Screenshot Outputs

By default these files are written under `<configured workspace>/01_cad`:

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

1. State whether validation passed or failed.
2. If failed, list blocking errors first, especially overlaps, mount contact,
   footprint, or occupancy failures.
3. State where `cad_agent_output.json` was updated.
4. State screenshot paths when screenshots were captured.
5. State `progress_json_path` and the three progress percentages.
6. If `--strict` was not used, remember that operational success can still
   contain `validation.success=false`.

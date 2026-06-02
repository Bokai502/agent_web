---
name: cad-sim-report-agent
description: "CLI-first report workflow for FreeCAD/COMSOL workspaces such as FreeCAD_data/v*_data. Use when Codex needs to generate a CAD geometry plus thermal simulation report, include FreeCAD/ParaView images and key data tables, inspect 01_cad and 02_sim artifacts, or produce modification suggestions from an explicit workspace path."
---

# CAD Sim Report Agent

Generate a data-backed CAD and thermal simulation report from a workspace root.
Use the bundled CLI; do not hand-write ad hoc extraction code.

Expected workspace shape:

```text
<workspace>/
  00_inputs/
  01_cad/
  02_sim/
  logs/
```

## Workflow

1. Resolve the workspace to an absolute path. Do not guess from unrelated repo
   roots when the user provides a specific workspace.
2. Mark report progress as running with the FreeCAD progress CLI.
3. Run this skill's report CLI from `/home/lbk/.codex/skills/cad-sim-report-agent`.
4. Mark report progress as completed or failed.
5. Report the generated artifact paths and the main status/limitations.

## Progress

Use the FreeCAD progress CLI to update `<workspace>/logs/progress.json` only.
Do not create or modify `<workspace>/logs/progress_percentages.json`.

Progress commands must run from the FreeCAD skill directory:

```bash
cd /data/lbk/codex_web/freecad_skills/freecad-skill
```

Before the report command:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir /abs/path/to/FreeCAD_data/v9_data \
  --loop-name cad_sim_report \
  --status running \
  --completed false \
  --percentage 0
```

After success:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir /abs/path/to/FreeCAD_data/v9_data \
  --loop-name cad_sim_report \
  --status completed \
  --completed true \
  --percentage 100
```

After failure:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir /abs/path/to/FreeCAD_data/v9_data \
  --loop-name cad_sim_report \
  --status failed \
  --completed true \
  --percentage 100
```

The loop name must be `cad_sim_report`. The `--completed` value must be exactly
`true` or `false`.

## Report CLI

Run commands from this skill directory:

```bash
cd /home/lbk/.codex/skills/cad-sim-report-agent
python3 scripts/analyze_workspace.py \
  --workspace /abs/path/to/FreeCAD_data/v9_data
```

Equivalent positional form:

```bash
python3 scripts/analyze_workspace.py /abs/path/to/FreeCAD_data/v9_data
```

Optional output override:

```bash
python3 scripts/analyze_workspace.py \
  --workspace /abs/path/to/FreeCAD_data/v9_data \
  --out-dir /abs/path/to/FreeCAD_data/v9_data/reports
```

The CLI writes:

- `<out-dir>/report.md`
- `<out-dir>/modifications.md`
- `<out-dir>/summary.json`

Default output directory is `<workspace>/reports`. The CLI prints a JSON payload
with `ok`, `workspace`, `outputs`, and `summary`.

## Evidence Rules

The report is generated from available files under `01_cad`, `02_sim`, and
`logs`. Key inputs include CAD outputs, `simulation_input.json`, COMSOL status
and solver artifacts, ParaView/postprocess images and stats, analysis JSON, and
FreeCAD screenshots.

- Prefer finalized top-level simulation outputs under `02_sim/simulation`.
  Fall back to `_comsol_work/sim` only for in-progress or failed runs.
- Do not claim simulation completion unless `run_manifest.json`, `status.json`,
  or exported artifacts support it.
- Do not claim thermal visualization is complete unless `native.vtu`,
  `field_stats.json`, `render_summary.json`, and PNG outputs are present.
- Do not hide CAD validation failures just because COMSOL solved.
- Keep report claims factual and tied to workspace evidence.
- Markdown links in `report.md` must be relative to the report directory, not
  absolute local paths.
- State coverage limits explicitly, especially missing artifacts or narrow
  `field_samples.json` coverage.

## Report Gating

- Before generating a final report, check CAD validation and simulation status.
- If CAD validation or simulation failed, generate and describe the output only
  as a failure report or diagnostic report.
- Never mark a report as a final or completed engineering result when upstream
  execution failed.

## Expected Report Content

`report.md` should be a detailed engineering Markdown report with:

- summary, model description, inputs, solver/settings, thermal results,
  temperature images, CAD/simulation validity checks, modification summary, and
  conclusion
- FreeCAD screenshots and ParaView/postprocess images when present
- tables for CAD artifacts, validation, components, heat sources, selections,
  solver artifacts, temperature stats, and analysis/root-cause records
- short analysis notes after major tables explaining what the data proves and
  what it does not prove

`modifications.md` should contain CAD suggestions, simulation suggestions,
report coverage suggestions, and validation steps. Suggestions must be derived
from observed data and name relevant files/components when possible.

## Error Handling

- If the workspace path does not exist, stop and report the path.
- If optional files are missing, still write the report and mark the fields as
  missing.
- If both top-level and `_comsol_work` status files exist, prefer the top-level
  status.
- If the report CLI fails after the running progress update, write the terminal
  failed progress update.
- If the CLI payload reports `ok: false`, surface the error details.

## Final Response

After running the CLI, report back in this order:

1. Pipeline/simulation status from `summary.status`.
2. CAD component and validation counts from `summary.cad`.
3. Thermal image/temperature coverage from `summary.thermal`.
4. Important limitations, especially missing artifacts or narrow sample
   coverage.

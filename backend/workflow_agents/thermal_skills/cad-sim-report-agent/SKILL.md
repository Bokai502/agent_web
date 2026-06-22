---
name: cad-sim-report-agent
description: "Mandatory CLI-first report workflow for satellite CAD/COMSOL workspaces with 00_inputs, 01_cad, 02_sim, and logs. Use for any request to generate, regenerate, summarize, review, inspect, or finalize CAD/thermal simulation reports, including full workflows that end with 输出报告/report. Do not hand-write thermal_report.md or ad hoc report JSON when this skill can run."
---

# CAD Sim Report Agent

Generate a data-backed CAD and thermal simulation report from a workspace root.
Use the bundled CLI; do not hand-write ad hoc extraction code.

Use this skill whenever the user asks for a report, final report, report
regeneration, report summary, CAD/simulation review, modification suggestions,
or a full CAD plus thermal simulation workflow that includes report output.
Other skills may create `00_inputs`, `01_cad`, and `02_sim`; this skill owns the
reporting step.

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
2. Run the skill's report CLI from cad-sim-report-agent.
3. Report the generated artifact paths and the main status/limitations.

## Progress

Do not create or modify `<workspace>/logs/progress_percentages.json`.

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

## Mandatory Usage

- Do not generate `thermal_report.md`, `thermal_report_summary.json`,
  `report.md`, `summary.json`, or equivalent report files with inline shell,
  Node, Python snippets, or manual Markdown assembly.
- Do not satisfy "重新生成报告", "总结报告", "输出报告", "final report", or
  "thermal/CAD simulation report" by only checking existing report files unless
  the user explicitly asks for file existence.
- If upstream artifacts are missing, still run this CLI to produce the best
  available diagnostic report, or explain which required workspace path is
  missing before stopping.
- When this skill is used as the final stage of a larger workflow, run it after
  CAD/simulation execution and validation gates, rather than embedding report
  writing in the executor step.

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
- Do not hide CAD validation hard failures just because COMSOL solved. CAD
  validation warnings must be reported as residual geometry risk, but they do
  not make a successful CAD gate fail.
- Keep report claims factual and tied to workspace evidence.
- Markdown links in `report.md` must be relative to the report directory, not
  absolute local paths.
- State coverage limits explicitly, especially missing artifacts or narrow
  `field_samples.json` coverage.

## Report Gating

- Before generating a final report, check CAD validation and simulation status.
- If CAD validation hard failures or simulation failures occurred, generate and
  describe the output only as a failure report or diagnostic report.
- If CAD validation has `success == true` with warnings, a final report is
  allowed, and the warnings must be included in the validation/risk discussion.
- When CAD validation warnings are present, the final user-facing response
  should ask whether the user wants to modify CAD/layout inputs to resolve them.
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

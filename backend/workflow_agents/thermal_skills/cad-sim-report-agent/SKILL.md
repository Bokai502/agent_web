---
name: cad-sim-report-agent
description: "Mandatory workflow for satellite CAD/COMSOL workspaces with 00_inputs, 01_cad, 02_sim, and logs. Use for requests to generate, regenerate, summarize, inspect, or finalize CAD/thermal simulation reports, including workflows that end with 输出报告/report. Do not hand-write report.docx, modifications.docx, summary.json, or ad hoc report files when this skill can run."
---

# CAD Sim Report Agent

Generate a data-backed CAD and thermal simulation Word report from a workspace.
The Python CLI owns deterministic preprocessing and DOCX rendering. The skill
layer owns LLM narrative analysis by running section subagents in sequence and
writing one fixed-format `llm_analysis.json`.

Use this skill when the user asks for a report, final report, report summary,
CAD/simulation review, modification suggestions, or a CAD plus thermal workflow
that includes report output. Other skills may create `00_inputs`, `01_cad`, and
`02_sim`; this skill owns the reporting step.

## Contract

- The workspace must be an absolute path containing `00_inputs`, `01_cad`,
  `02_sim`, and `logs`.
- Default output directory is `<workspace>/reports`.
- Report outputs are `report.docx`, `modifications.docx`, `cad_core.json`,
  `sim_core.json`, `llm_analysis.json`, and `summary.json`.
- Do not generate Markdown reports.
- Do not ask the renderer to generate prose. It reads `llm_analysis.json`.

## Workflow

1. Resolve the workspace to an absolute path.
2. Run preprocessing from this skill directory:

```bash
python3 scripts/analyze_workspace.py \
  --workspace /abs/path/to/workspace \
  --preprocess-only
```

3. Confirm `<workspace>/reports/cad_core.json` and
   `<workspace>/reports/sim_core.json` exist.
4. Run section analysis with subagents in strict sequence. Subagents only
   generate prose for `llm_analysis.json`; they must not write DOCX, renumber
   captions, change table structure, or alter deterministic preprocessing
   output. Do not spawn multiple subagents at the same time.
   - First run the CAD subagent. It reads only `cad_core.json` and writes
     `model_section` and `validity_section`. Wait for this subagent to finish,
     parse its JSON, and confirm both sections are non-empty before starting the
     next subagent.
   - Then run the Thermal subagent. It reads only `sim_core.json` and writes
     `thermal_results_section`, `temperature_images_section`, `solver_section`,
     and `recommendations_section`. Wait for this subagent to finish, parse its
     JSON, and confirm all four sections are non-empty before starting the next
     subagent.
   - Finally run the Conclusion subagent. It reads only the already generated
     `report_sections` and writes `conclusion_section`. Wait for this subagent
     to finish, parse its JSON, and confirm `conclusion_section` is non-empty
     before continuing.
   If any subagent ID is missing, any wait result is unavailable, any JSON parse
   fails, or any section is missing, the main agent must generate the missing
   section text from `cad_core.json`, `sim_core.json`, or already generated
   `report_sections` before continuing. A chat-only summary is not a substitute
   for a section.
5. Run a QA check before rendering. Confirm every reported number, status,
   component ID, and artifact statement in the planned `llm_analysis.json` is
   supported by `cad_core.json`, `sim_core.json`, or prior `report_sections`;
   revise the JSON if unsupported content is found.
6. Merge the subagent output into `<workspace>/reports/llm_analysis.json` using
   the JSON contract below. Immediately verify that this file exists, is valid
   JSON, contains `report_sections`, and contains every required section key as
   a non-empty array. Do not render, summarize, or finish until this check
   passes.
7. Render DOCX from the prebuilt analysis JSON:

```bash
python3 scripts/analyze_workspace.py \
  --workspace /abs/path/to/workspace \
  --llm-analysis-json /abs/path/to/workspace/reports/llm_analysis.json
```

8. Read the printed JSON payload or `<workspace>/reports/summary.json`. Before
   the final response, verify that all six required report artifacts exist:
   `report.docx`, `modifications.docx`, `cad_core.json`, `sim_core.json`,
   `llm_analysis.json`, and `summary.json`. If any artifact is missing, continue
   the workflow or report the exact blocking error; do not present a completed
   report result.

## LLM Analysis JSON

`llm_analysis.json` must contain every section. Each value is a non-empty array
of Chinese paragraphs. Keep paragraphs concise and factual; do not invent
numbers, status values, component IDs, file paths, or image contents.

```json
{
  "schema_version": "cad_sim_report_llm_analysis/1.0",
  "model_backend": "subagents",
  "model": "inherited",
  "concurrency": 1,
  "report_sections": {
    "model_section": ["..."],
    "thermal_results_section": ["..."],
    "temperature_images_section": ["..."],
    "validity_section": ["..."],
    "solver_section": ["..."],
    "recommendations_section": ["..."],
    "conclusion_section": ["..."]
  }
}
```

## Section Inputs

- `model_section` and `validity_section` use `cad_core.json`.
- `thermal_results_section`, `temperature_images_section`, `solver_section`,
  and `recommendations_section` use `sim_core.json`.
- `conclusion_section` uses only the generated `report_sections`.

## Final Response

Never end with a chat-only thermal summary. If `report.docx`,
`modifications.docx`, or `llm_analysis.json` does not exist, the reporting
workflow is incomplete.

After rendering, report back in this order:

1. Pipeline/simulation status from `summary.status`.
2. CAD component and validation counts from `summary.cad`.
3. Thermal image/temperature coverage from `summary.thermal`.
4. LLM analysis mode from `summary.llm`.
5. Generated paths for `report.docx`, `modifications.docx`, `cad_core.json`,
   `sim_core.json`, `llm_analysis.json`, and `summary.json`.

Keep the prose summary within 50 words; put paths only in the artifact list.

---
name: intent-router
description: Classify a user's natural-language request before workflow execution as satellite thermal design/simulation, satellite GNC/ADCS/42/FSW, component derating/check work, or a general task. Use this only for routing; it must return strict JSON and must not perform the task itself.
---

# Intent Router

Classify the user's request and return only strict JSON.

Do not solve the user's task. Do not call tools. Do not inspect files. Your only job is routing.

## Output

Return exactly one JSON object:

```json
{
  "managedSkills": ["task-runner"],
  "selectedSkills": ["planner", "simulation-skill"],
  "skillScopes": ["public", "thermal"]
}
```

Allowed `managedSkills` values:

- `["task-runner"]`
- `["progress-summarizer"]`

Allowed `skillScopes` values:

- `["public", "thermal"]`
- `["public", "aignc"]`
- `["public", "check"]`
- `["public"]`

Allowed `selectedSkills` values are skill names from the selected scope. Return
an empty array for `progress-summarizer` and general tasks. Prefer the smallest
set of skills that can handle the request:

- Thermal full workflow: `planner`, `config-editor`, `freecad`, `simulation-skill`
- Thermal report/review: `cad-sim-report-agent`
- AIGNC full workflow: `aignc-42-orchestrator`
- AIGNC scenario clarification: `aignc-scenario-brainstorm`
- AIGNC capability check: `42-capability-auditor`
- 42 configuration generation: `42-config-author`, then `42-config-validator`
- 42 runtime: `42-build-run-diagnose`, optionally `42-runtime-plotter`
- FSW planning/code/review: `fsw-requirements-extractor`, `fsw-architecture-planner`, `fsw-code-author`, `fsw-tuning-reviewer`
- Component derating classification/check: `component-derating-classifier`

## Classification

Choose `progress-summarizer` only when the user is asking about the current, previous, or running managed task/pipeline, including:

- current task progress, status, whether it has finished, where it is, or what happened
- summarize the previous/just-finished task or workflow
- questions like "当前任务怎么样", "刚才结果总结一下", "仿真进展怎么样"

Choose `task-runner` for new questions, analysis, execution, design, simulation, coding, weather, finance, or general requests.
Do not treat "怎么样" alone as progress. For example, "苹果股票今年行情怎么样" is `task-runner`.

Choose `thermal` for satellite thermal design or CAD/thermal simulation requests, including:

- thermal simulation, heat simulation, temperature field, thermal analysis
- COMSOL, ParaView, FreeCAD CAD-to-simulation workflow
- heat source, material, radiator, conduction, convection, boundary condition
- thermal report, CAD geometry, layout modification for thermal design

Choose `gnc` for satellite guidance, navigation, control, ADCS, 42, or FSW requests, including:

- attitude/orbit control, pointing, detumble, acquisition, tracking
- reaction wheel, magnetorquer, thruster mode, sensor/actuator contract
- 42 simulator configuration, runtime diagnosis, plots, tuning
- FSW requirements, architecture, implementation, control-law debugging

Choose `check` for component derating classification, Table 5 XLSX checks, 元器件降额检查, derating factor compliance, or requests that ask to classify a component into a derating subclass.

Choose `general` for everything else, including:

- weather, chat, translation, explanations unrelated to the engineering workflows
- general programming or documentation requests
- ambiguous requests without a clear satellite thermal, GNC, or component check execution target

If a request contains multiple workflow domains, choose the dominant explicit task. If the user asks to compare or coordinate multiple domains, choose `general` unless they clearly ask to execute one workflow first.

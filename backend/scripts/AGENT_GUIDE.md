# Thermal Simulation Agent Workflow

Main Chain: Agent Workflow = Planner + Executer + Reviewer

Debug Chain: Debug Workflow = Debugger -> Planner + Executer -> check result -> repeat if needed

Debug loop:
1. Debugger reads the failing artifact or error file and explains the root cause with evidence.
2. Debugger writes concrete modification suggestions for the next Planner run.
3. Planner updates `00_inputs` and writes `00_inputs/planner_ouput.md`.
4. Executer runs the CAD/simulation workflow from the updated `00_inputs`.
5. If validation succeeds, continue to the next normal workflow step.
6. If validation still fails, return to step 1 with the newest error file and repeat Debugger -> Planner + Executer.


## 0. Debugger

When to invoke: an error file, failed validation, failed CAD build, failed simulation run, or inconsistent artifact is present.

Skill: none required. Use direct evidence from the failed artifact first.

Inputs:
- failed file, for example `01_cad/cad_agent_output.json`
- related inputs from `00_inputs`
- related outputs from `01_cad` or `02_sim`

Outputs:
- root-cause explanation with file paths and exact evidence
- concrete modification suggestions for Planner
- decision: continue normal workflow if no issue remains, or run Planner + Executer again

## 1. Planner

When to invoke: define the thermal simulation task, inputs, constraints, and execution plan.

Skill: `planner`.

Inputs:
- user goal, `00_inputs`

Outputs:
- `00_inputs/planner_ouput.md`

## 2. Executer

When to invoke: prepare the model, run the simulation, and generate result artifacts according to the Planner output.

Skill:
- `freecad`
- `simulation-skill`

Inputs:
- `00_inputs`

Outputs:
- `01_cad`
- `02_sim`

## 3. Reviewer

When to invoke: review the execution results and produce the final report.

Skill: `cad-sim-report-agent`.

Inputs:
- `00_inputs`
- `01_cad`
- `02_sim`

Outputs:
- `reports`

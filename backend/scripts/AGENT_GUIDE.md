# Thermal Simulation Agent Workflow

Main Chain: Agent Workflow = Planner + Executer + Reviewer


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

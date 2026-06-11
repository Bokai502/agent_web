# Repo Sources

Use this reference as the entry map for `aignc-design-closure-auditor`.

## Design Inputs

- raw design document or extracted text
- user-confirmed clarifications in the thread
- `<workspace>/AIGNC_Workflow/01_inputs/`
- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`
- `<workspace>/AIGNC_Workflow/02_scenario/scenario_understanding.md`

## Default Workspace

Expect `<workspace>` from `workspace_dir` to contain:

- `<workspace>/AIGNC_Workflow/01_inputs/`
- `<workspace>/AIGNC_Workflow/02_scenario/`
- `<workspace>/AIGNC_Workflow/03_capability/`
- `<workspace>/AIGNC_Workflow/04_config/`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/`
- `<workspace>/AIGNC_Workflow/08_run/`
- `<workspace>/AIGNC_Workflow/09_audit/` or `09_tuning_review/`
- `<workspace>/AIGNC_Workflow/10_reports/`
- final validated config under `<workspace>/00_inputs/Config/`
- real simulation evidence under `<workspace>/02_sim/42_run/`

## Required Upstream Artifacts

### Scenario

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`
- `<workspace>/AIGNC_Workflow/02_scenario/scenario_understanding.md`

### Capability

- `<workspace>/AIGNC_Workflow/03_capability/42_capability_assessment.md`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`

### Configuration

- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/Orb_*.txt`
- `<workspace>/AIGNC_Workflow/04_config/SC_*.txt`
- optional other generated `Inp_*.txt`

### Static Validation

- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_report.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_summary.json`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.json`

### FSW Requirements

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

### FSW Architecture And Implementation

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`
- optional tuning outputs:
  - `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_review.md`
  - `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_hypotheses.json`
- implementation outputs when split from architecture:
  - `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
  - `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

### Runtime

- `<workspace>/AIGNC_Workflow/08_run/run_report.md`
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`
- `<workspace>/02_sim/42_run/runtime_case/InOut/`
- runtime telemetry such as:
  - `ModeTrace_SC00.csv`
  - `Sc.csv`
  - `AcWhl.csv`
  - standard plots

## Audit Targets

Always examine, when relevant:

- orbit fidelity
- initial condition fidelity
- sensor inventory fidelity
- sensor parameter fidelity
- actuator inventory fidelity
- actuator parameter fidelity
- mode set fidelity
- transition-condition fidelity
- performance-requirement closure evidence
- assumption and approximation traceability

## Output Files

The audit skill should produce:

- `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.md`
- `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.json`
- `<workspace>/AIGNC_Workflow/10_reports/rework_route.json`

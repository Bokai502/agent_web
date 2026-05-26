# Repo Sources

Use this reference as the entry map for `aignc-design-closure-auditor`.

## Design Inputs

- raw design document or extracted text
- user-confirmed clarifications in the thread
- `02_scenario/scenario_facts.json`
- `02_scenario/open_questions.json`
- `02_scenario/scenario_understanding.md`

## Default Case Root

Expect a staged case root shaped like:

- `01_inputs/`
- `02_scenario/`
- `03_capability/`
- `04_config/`
- `05_fsw_requirements/`
- `06_fsw_architecture/`
- `07_fsw_implementation/`
- `08_run/`
- `09_audit/`
- `10_reports/`

## Required Upstream Artifacts

### Scenario

- `02_scenario/scenario_facts.json`
- `02_scenario/open_questions.json`
- `02_scenario/scenario_understanding.md`

### Capability

- `03_capability/42_capability_assessment.md`
- `03_capability/capability_assessment.json`

### Configuration

- `04_config/generated_config_manifest.json`
- `04_config/Inp_Sim.txt`
- `04_config/Orb_*.txt`
- `04_config/SC_*.txt`
- optional other generated `Inp_*.txt`

### Static Validation

- `04_config/validation/config_validation_report.md`
- `04_config/validation/config_validation_summary.json`
- `04_config/validation/requirements_trace.md`
- `04_config/validation/requirements_trace.json`

### FSW Requirements

- `05_fsw_requirements/fsw_requirement_spec.md`
- `05_fsw_requirements/mode_table.json`
- `05_fsw_requirements/sensor_actuator_contract.json`

### FSW Architecture And Implementation

- `06_fsw_architecture/fsw_architecture_plan.md`
- `06_fsw_architecture/file_change_map.json`
- `06_fsw_architecture/truth_model_extension_boundary.json`
- optional tuning outputs:
  - `06_fsw_architecture/fsw_tuning_review.md`
  - `06_fsw_architecture/fsw_tuning_hypotheses.json`
- implementation outputs when split from architecture:
  - `07_fsw_implementation/fsw_code_author_report.md`
  - `07_fsw_implementation/fsw_change_set.json`

### Runtime

- `08_run/run_report.md`
- `08_run/run_summary.json`
- `08_run/runtime_case/InOut/`
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

- `design_closure_audit.md`
- `design_closure_audit.json`
- `rework_route.json`
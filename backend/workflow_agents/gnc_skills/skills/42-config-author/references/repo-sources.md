# Repo Sources

Use this reference as the entry map for `42-config-author`.

## Primary spec

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-author-spec.md`

## Primary 42 knowledge

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

## Structured indexes

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`


## Default template package

Use `open_codex_web/data/input_data/gnc/00_inputs/Config/` as the default complete configuration template package when no closer workspace template is specified. For ordinary satellite scenarios, copy the template support files unchanged and fully author the minimal core files line-by-line:

- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/Orb_*.txt` referenced by `Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/SC_*.txt` referenced by `Inp_Sim.txt`

Every required field in those core files must be set from approved scenario facts, audited assumptions, an applicable documented template default, or an explicit conservative default recorded in the manifest. If a mission-defining field cannot be resolved, ask the user instead of leaving the template value as a silent placeholder.

Template support files normally copied unchanged include:

- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_Cmd.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_AcOutput.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_ScOutput.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_Graphics.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_CommLink.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_FOV.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_IPC.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_Region.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_Shaker.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Inp_TDRS.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Flex_*.txt`
- `open_codex_web/data/input_data/gnc/00_inputs/Config/Readme.txt`

Only modify support files when the scenario explicitly requires command timelines, telemetry output changes, graphics/FOV changes, comm links, IPC, regions/contact, shaker/flex, TDRS, or equivalent ancillary features.

## Detail layer

Load only the needed detailed schemas:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_sim.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/orb.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/sc.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_cmd.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/output_files.schema.json`
- relevant sensor and actuator schemas under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/`

## Intended outputs

- generated 42 input files
- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `<workspace>/AIGNC_Workflow/04_config/config_generation_summary.md`

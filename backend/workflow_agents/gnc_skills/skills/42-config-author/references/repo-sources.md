# Repo Sources

Use this reference as the entry map for `42-config-author`.

## Primary spec

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-author-spec.md`

## Primary 42 knowledge

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

## Structured indexes

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`


## Default template package

Use `demo_server/open_codex_web/data/input_data/gnc/Config/` as the default complete configuration template package when no closer workspace template is specified. For ordinary satellite scenarios, copy the template support files unchanged and fully author the minimal core files line-by-line:

- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/Orb_*.txt` referenced by `Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/SC_*.txt` referenced by `Inp_Sim.txt`

Every required field in those core files must be set from approved scenario facts, audited assumptions, an applicable documented template default, or an explicit conservative default recorded in the manifest. If a mission-defining field cannot be resolved, ask the user instead of leaving the template value as a silent placeholder.

Template support files normally copied unchanged include:

- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_Cmd.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_AcOutput.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_ScOutput.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_Graphics.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_CommLink.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_FOV.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_IPC.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_Region.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_Shaker.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Inp_TDRS.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Flex_*.txt`
- `demo_server/open_codex_web/data/input_data/gnc/Config/Readme.txt`

Only modify support files when the scenario explicitly requires command timelines, telemetry output changes, graphics/FOV changes, comm links, IPC, regions/contact, shaker/flex, TDRS, or equivalent ancillary features.

## Detail layer

Load only the needed detailed schemas:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_sim.schema.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/orb.schema.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/sc.schema.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_cmd.schema.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/output_files.schema.json`
- relevant sensor and actuator schemas under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/`

## Intended outputs

- generated 42 input files
- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `<workspace>/AIGNC_Workflow/04_config/config_generation_summary.md`

# Repo Sources

Use this reference as the entry map for `42-config-author`.

## Primary spec

- `knowledge/skills/42-config-author-spec.md`

## Primary 42 knowledge

- `knowledge/42/inputs.md`
- `knowledge/42/orbit_env.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/limitations.md`
- `knowledge/42/examples.md`

## Structured indexes

- `knowledge/42/capabilities/inputs.json`
- `knowledge/42/capabilities/sensors.json`
- `knowledge/42/capabilities/actuators.json`
- `knowledge/42/capabilities/orbit_env.json`


## Default template package

Use the active workspace's `00_inputs/Config/` directory as the default complete configuration template package when no closer input template is specified. For ordinary satellite scenarios, copy the template support files unchanged and fully author the minimal core files line-by-line:

- `workspace_dir/AIGNC_Workflow/04_config/Inp_Sim.txt`
- `workspace_dir/AIGNC_Workflow/04_config/Orb_*.txt` referenced by `Inp_Sim.txt`
- `workspace_dir/AIGNC_Workflow/04_config/SC_*.txt` referenced by `Inp_Sim.txt`

Every required field in those core files must be set from approved scenario facts, audited assumptions, an applicable documented template default, or an explicit conservative default recorded in the manifest. If a mission-defining field cannot be resolved, ask the user instead of leaving the template value as a silent placeholder.

Template support files normally copied unchanged include:

- `00_inputs/Config/Inp_Cmd.txt`
- `00_inputs/Config/Inp_AcOutput.txt`
- `00_inputs/Config/Inp_ScOutput.txt`
- `00_inputs/Config/Inp_Graphics.txt`
- `00_inputs/Config/Inp_CommLink.txt`
- `00_inputs/Config/Inp_FOV.txt`
- `00_inputs/Config/Inp_IPC.txt`
- `00_inputs/Config/Inp_Region.txt`
- `00_inputs/Config/Inp_Shaker.txt`
- `00_inputs/Config/Inp_TDRS.txt`
- `00_inputs/Config/Flex_*.txt`
- `00_inputs/Config/Readme.txt`

Only modify support files when the scenario explicitly requires command timelines, telemetry output changes, graphics/FOV changes, comm links, IPC, regions/contact, shaker/flex, TDRS, or equivalent ancillary features.

## Detail layer

Load only the needed detailed schemas:

- `knowledge/42/details/inputs/inp_sim.schema.json`
- `knowledge/42/details/inputs/orb.schema.json`
- `knowledge/42/details/inputs/sc.schema.json`
- `knowledge/42/details/inputs/inp_cmd.schema.json`
- `knowledge/42/details/inputs/output_files.schema.json`
- relevant sensor and actuator schemas under `knowledge/42/details/`

## Intended outputs

- generated 42 input files
- `workspace_dir/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `workspace_dir/AIGNC_Workflow/04_config/config_generation_summary.md`

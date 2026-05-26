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
- `generated_config_manifest.json`
- `config_generation_summary.md`

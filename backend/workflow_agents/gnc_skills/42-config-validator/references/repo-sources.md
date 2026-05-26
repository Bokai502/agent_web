# Repo Sources

Use this reference as the entry map for `42-config-validator`.

## Primary spec

- `knowledge/skills/42-config-validator-spec.md`

## Primary workflow context

- `knowledge/skills/42-config-workflow-current.md`

## Primary 42 knowledge

- `knowledge/42/inputs.md`
- `knowledge/42/limitations.md`

## Structured indexes

- `knowledge/42/capabilities/inputs.json`
- `knowledge/42/capabilities/limitations.json`

## Detail layer

Load only the detailed schemas needed for the generated files under review:

- `knowledge/42/details/inputs/*.json`
- relevant `knowledge/42/details/sensors/*.json`
- relevant `knowledge/42/details/actuators/*.json`

## Intended outputs

- `config_validation_report.md`
- `config_validation_summary.json`

## Local implementation

- `skills/42-config-validator/scripts/validate_42_config.py`

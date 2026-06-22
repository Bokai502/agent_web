# cad_cli

Composable CLI for CAD builder artifacts in thermal workspaces.

## Commands

```bash
cad_cli --json doctor --workspace-dir <workspace>
cad_cli --json paths --workspace-dir <workspace>
cad_cli --json build box --workspace-dir <workspace>
cad_cli --json build real-assembly --workspace-dir <workspace>
cad_cli --json build sim-input --workspace-dir <workspace>
cad_cli --json build after-state --workspace-dir <workspace>
cad_cli --json build all --workspace-dir <workspace>
```

`doctor` is read-only and validates the selected workspace input shape. It does
not connect to FreeCAD RPC.

Build commands use FreeCAD RPC settings from `config.json` unless `--host` and
`--port` are provided. Outputs are written under `<workspace>/01_cad` by
default.

Prefer the individual `build ...` commands in automation when a single JSON
object is required. `build all` is a convenience wrapper for manual full CAD
refreshes.

## JSON Policy

`--json` emits a stable CLI envelope. Success shapes include `ok` or
implementation-specific `success`; failures include:

```json
{
  "ok": false,
  "tool": "cad_cli",
  "error": "message"
}
```

The CLI does not require authentication and does not print secrets.

## Install

```bash
cd /data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/cad_cli
make install-local
command -v cad_cli
cad_cli --json doctor --workspace-dir /path/to/workspace/version
```

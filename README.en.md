# Agent Web

Agent Web is an Agent engineering workspace built with a React frontend and a Fastify backend. Runtime settings are loaded from the root `config.json`, including OpenAI/Agent settings, ports, workspace paths, speech services, and remote tool endpoints.

## Configuration File

The project does not create a real config automatically. Before the first run, copy the example file:

```bash
cd /path/to/agent-web
cp config.example.json config.json
```

Then edit `config.json`. Fields set to `xxx` in `config.example.json` must be filled for your environment. Adjacent `_...Comment` fields are only inline hints; they can stay in the real config or be removed. Do not commit real API keys, internal hosts, personal directories, or private model paths.

Port settings come from `config.json` only. `server.port`, `frontend.port`, and `frontend.httpsPort` are required; the source code and startup script do not embed fallback port numbers. Restart both services after changing ports.

Common fields:

| Field | Description |
| --- | --- |
| `chatModel` | Default internal model connection config. It can set `apiKey`, `baseUrl`, and `model`. Can be overridden with `CHAT_MODEL_API_KEY`, `CHAT_MODEL_BASE_URL`, and `CHAT_MODEL_NAME`. |
| `openai` | OpenAI backend connection config. It can set `apiKey`, `baseUrl`, and `model`. Can be overridden with `OPENAI_API_KEY` and `OPENAI_BASE_URL`. |
| `_...Comment` | Inline hints used only by `config.example.json`; the backend ignores these fields. |
| `codex.modelProvider` / `codex.wireApi` | Codex SDK provider metadata, such as `nexahub` and `responses`. |
| `codex.modelReasoningEffort` | Codex reasoning effort, such as `low`, `medium`, or `high`. |
| `codex.approvalPolicy` | Codex approval policy, such as `never` or `on-request`. |
| `codex.sandboxMode` | Codex sandbox mode, such as `workspace-write` or `danger-full-access`. |
| `codex.sandboxWorkspaceWriteNetworkAccess` | Allows network access for Agent commands when `sandboxMode` is `workspace-write`; set to `true` when commands must connect to local FreeCAD RPC or a private COMSOL `mphserver`. |
| `server.port` | Required backend port. Can be temporarily overridden by `BACKEND_PORT`. |
| `server.host` | Backend listen address, such as `0.0.0.0` or `127.0.0.1`. |
| `server.corsOrigin` | Optional list of frontend origins allowed to call the backend. If omitted, it is generated from `frontend.port`, `frontend.httpsPort`, and `frontend.publicHost`. |
| `frontend.host` | Host address for the Vite frontend server. |
| `frontend.publicHost` | Public hostname or IP printed by the startup script and included in generated CORS origins. Recommended when listening on `0.0.0.0`. |
| `frontend.port` | Required frontend HTTP development port. |
| `frontend.httpsPort` | Required frontend HTTPS development port. The startup script uses this by default. |
| `frontend.strictPort` | Whether Vite must use the configured port. Keeping this `true` avoids port drift. |
| `workspace.templateDir` | Template/input data root, for example `agent-web/data/input_data`. |
| `workspace.filesystemGroup` | Filesystem group applied to workspace files where possible. Use a group that the backend user belongs to. |
| `workspace.usersRoot` | Per-user workspace root, for example `/data/lbk/codex_web/data/users`. Legacy `auth.usersDir` is still supported as a fallback. |
| `workspace.rpcHost` / `workspace.rpcPort` | FreeCAD remote RPC settings. |
| `tools.remoteDesktopLauncher` | Shared launcher used by `/api/remote-tools/ensure-desktops` for FreeCAD and ParaView. |
| `tools.cad/paraview/comsol.displayNum` | X display used by each remote GUI tool, such as `:1`, `:2`, or `:32`. |
| `tools.cad/paraview/comsol.vncPort` | Local VNC port for each remote GUI tool. |
| `tools.cad/paraview/comsol.noVncPort` | noVNC port used by both frontend iframes and backend port checks. |
| `tools.cad/paraview/comsol.launcher` | Launcher path for each remote GUI tool; the backend calls `tools.comsol.launcher` directly for COMSOL. |
| `tools.cad.bin` | FreeCAD GUI executable used by `start_remote_gui_tools.sh`; can be temporarily overridden with `FREECAD_BIN`. |
| `tools.comsol.sudo` | Privilege command used when calling the COMSOL launcher, defaulting to `sudo`. |
| `gnc.dashboard.telemetryPaths` | Relative telemetry file paths used by the GNC dashboard. |
| `funasr.*` | Speech-to-text settings. Keep placeholders or set values to `null` if speech is not needed. |
| `cosyvoice.*` | TTS service settings. Keep placeholders or set values to `null` if speech playback is not needed. |
| `logging.*` | Log level, log file, and console output settings. |

## Install Dependencies

The recommended startup script checks and installs frontend/backend npm dependencies before starting services:

```bash
./start_agent_web.sh
```

You can also install them manually:

```bash
cd /path/to/agent-web/backend
npm install

cd /path/to/agent-web/frontend
npm install
```

To run Agent tasks, make sure the `codex` command is available:

```bash
npm install -g @openai/codex
codex --version
```

## Start The Project

The recommended entry point is the root startup script:

```bash
cd /path/to/agent-web
./start_agent_web.sh
```

The script first runs `scripts/validate_config.mjs --config config.json` against the real config file. It reports placeholder values, invalid field types, missing paths/executables, and external service connectivity problems for the model APIs, FunASR, CosyVoice, database, and related services. After validation passes, it checks npm dependencies, stops old `ocw-backend*` and `ocw-frontend*` tmux sessions, frees the configured ports, starts the remote GUI tools, then starts the backend and frontend separately.

`start_agent_web.sh` is a thin entry point. The actual steps live under `scripts/`:

| Script | Purpose |
| --- | --- |
| `scripts/validate_start_config.sh` | Validates `config.json` before startup. |
| `scripts/install_node_deps.sh` | Runs `npm install --no-audit --no-fund` for `backend` and `frontend`. |
| `scripts/restart_web_services.sh` | Stops old tmux sessions, frees ports, starts remote GUI tools, and restarts backend/frontend services. |
| `scripts/start_common.sh` | Shared config, port, and tmux helper functions. |

You can run validation manually:

```bash
node scripts/validate_config.mjs --config config.json
```

For local debugging, skip external service connectivity checks:

```bash
SKIP_CONFIG_SERVICE_CHECKS=1 ./start_agent_web.sh
```

To skip all startup validation:

```bash
SKIP_CONFIG_VALIDATE=1 ./start_agent_web.sh
```

After a successful start, it prints output similar to:

```text
backend:  http://localhost:<server.port>  tmux=ocw-backend
frontend: https://<frontend.publicHost or frontend.host>:<frontend.httpsPort>  tmux=ocw-frontend
```

You can also start the services manually:

```bash
cd /path/to/agent-web/backend
BACKEND_PORT="$(node -p "require('../config.json').server.port")" npm run dev
```

```bash
cd /path/to/agent-web/frontend
npm run dev:https -- --host "$(node -p "require('../config.json').frontend.host")" --port "$(node -p "require('../config.json').frontend.httpsPort")" --strictPort
```

The Vite frontend proxy reads `server.port` from the same `config.json`. If you manually override the backend with `BACKEND_PORT`, pass the same `BACKEND_PORT` to the frontend command.

## Remote GUI Tools

Remote GUI tools are still controlled through the root entry point:

```bash
./start_remote_gui_tools.sh start
./start_remote_gui_tools.sh status
./start_remote_gui_tools.sh restart
./start_remote_gui_tools.sh stop
```

`start_remote_gui_tools.sh` is also a thin entry point. Its implementation is split under `scripts/`:

| Script | Purpose |
| --- | --- |
| `scripts/remote_gui_common.sh` | Reads `config.json`, loads DISPLAY/VNC/noVNC/RPC settings, and defines shared helpers. |
| `scripts/remote_gui_desktop.sh` | Manages Xvfb, openbox, x11vnc, and noVNC. |
| `scripts/remote_gui_freecad_rpc.sh` | Manages FreeCAD RPC, port ownership checks, and FreeCAD startup. |
| `scripts/remote_gui_runtime.sh` | Orchestrates `start`, `stop`, `restart`, and `status`. |

These scripts still read `tools.cad/paraview/comsol.*`, `workspace.rpcHost`, and `workspace.rpcPort`; external commands are unchanged.

## Build Check

```bash
cd /path/to/agent-web/backend
npm run build

cd /path/to/agent-web/frontend
npm run build
```

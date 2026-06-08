# Open Codex Web

Open Codex Web is a Codex engineering workspace built with a React frontend and a Fastify backend. Runtime settings are loaded from the root `config.json`, including OpenAI/Codex settings, ports, workspace paths, speech services, and remote tool endpoints.

## Configuration File

The project does not create a real config automatically. Before the first run, copy the example file:

```bash
cd /path/to/open_codex_web
cp config.example.json config.json
```

Then edit `config.json`. Do not commit real API keys, internal hosts, personal directories, or private model paths.

Port settings come from `config.json` only. `server.port`, `frontend.port`, and `frontend.httpsPort` are required; the source code and startup script do not embed fallback port numbers. Restart both services after changing ports.

Common fields:

| Field | Description |
| --- | --- |
| `openai.apiKey` | API key for OpenAI or an OpenAI-compatible service. Can be overridden by `OPENAI_API_KEY`. |
| `openai.baseUrl` | API base URL for OpenAI or an OpenAI-compatible service. Can be overridden by `OPENAI_BASE_URL`. |
| `openai.model` | Default model used by Codex. |
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
| `workspace.templateDir` | Template/input data root, for example `open_codex_web/data/input_data`. |
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
| `whisper.*` | Speech-to-text settings. Keep placeholders or set values to `null` if speech is not needed. |
| `cosyvoice.*` | TTS service settings. Keep placeholders or set values to `null` if speech playback is not needed. |
| `logging.*` | Log level, log file, and console output settings. |

## Install Dependencies

```bash
cd /path/to/open_codex_web/backend
npm install

cd /path/to/open_codex_web/frontend
npm install
```

To run Codex Agent tasks, make sure the `codex` command is available:

```bash
npm install -g @openai/codex
codex --version
```

## Start The Project

The recommended entry point is the root startup script:

```bash
cd /path/to/open_codex_web
./start_open_codex_web.sh
```

The script reads `config.json`, stops old `ocw-backend*` and `ocw-frontend*` tmux sessions, frees the backend port, then starts the backend and frontend separately.

After a successful start, it prints output similar to:

```text
backend:  http://localhost:<server.port>  tmux=ocw-backend
frontend: https://<frontend.publicHost or frontend.host>:<frontend.httpsPort>  tmux=ocw-frontend
```

You can also start the services manually:

```bash
cd /path/to/open_codex_web/backend
BACKEND_PORT="$(node -p "require('../config.json').server.port")" npm run dev
```

```bash
cd /path/to/open_codex_web/frontend
npm run dev:https -- --host "$(node -p "require('../config.json').frontend.host")" --port "$(node -p "require('../config.json').frontend.httpsPort")" --strictPort
```

The Vite frontend proxy reads `server.port` from the same `config.json`. If you manually override the backend with `BACKEND_PORT`, pass the same `BACKEND_PORT` to the frontend command.

## Build Check

```bash
cd /path/to/open_codex_web/backend
npm run build

cd /path/to/open_codex_web/frontend
npm run build
```

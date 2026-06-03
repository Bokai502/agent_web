# Open Codex Web

Open Codex Web is a Codex engineering workspace built with a React frontend and a Fastify backend. Runtime settings are loaded from the root `config.json`, including OpenAI/Codex settings, ports, workspace paths, speech services, and remote tool endpoints.

## Configuration File

The project does not create a real config automatically. Before the first run, copy the example file:

```bash
cd /path/to/open_codex_web
cp config.example.json config.json
```

Then edit `config.json`. Do not commit real API keys, internal hosts, personal directories, or private model paths.

Common fields:

| Field | Description |
| --- | --- |
| `openai.apiKey` | API key for OpenAI or an OpenAI-compatible service. Can be overridden by `OPENAI_API_KEY`. |
| `openai.baseUrl` | API base URL for OpenAI or an OpenAI-compatible service. Can be overridden by `OPENAI_BASE_URL`. |
| `openai.model` | Default model used by Codex. |
| `codex.workingDirectory` | Default working directory for Codex tasks. |
| `codex.approvalPolicy` | Codex approval policy, such as `never` or `on-request`. |
| `codex.sandboxMode` | Codex sandbox mode, such as `workspace-write` or `danger-full-access`. |
| `server.port` | Backend port. Can be overridden by `BACKEND_PORT`. |
| `server.corsOrigin` | List of frontend origins allowed to call the backend. |
| `frontend.host` | Host address for the Vite frontend server. |
| `frontend.port` | Frontend HTTP development port. |
| `frontend.httpsPort` | Frontend HTTPS development port. The startup script uses this by default. |
| `workspace.workspaceDir` | Default engineering workspace directory. The startup script requires this field to be non-empty. |
| `workspace.rpcHost` / `workspace.rpcPort` | FreeCAD remote RPC settings. |
| `tools.*.noVncPort` | noVNC ports for remote GUI tools such as CAD, ParaView, and COMSOL. |
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
frontend: https://<host>:<frontend.httpsPort>  tmux=ocw-frontend
```

You can also start the services manually:

```bash
cd /path/to/open_codex_web/backend
npm run dev
```

```bash
cd /path/to/open_codex_web/frontend
npm run dev:https -- --host 0.0.0.0 --port 5175 --strictPort
```

## Build Check

```bash
cd /path/to/open_codex_web/backend
npm run build

cd /path/to/open_codex_web/frontend
npm run build
```


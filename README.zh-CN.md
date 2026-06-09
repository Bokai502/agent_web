# Open Codex Web

Open Codex Web 是一个由 React 前端和 Fastify 后端组成的 Codex 工程工作台。项目通过根目录下的 `config.json` 读取 OpenAI/Codex、服务端口、工作区、语音和远程工具配置。

## 配置文件

项目不会自动创建真实配置。第一次启动前，请复制示例配置：

```bash
cd /path/to/open_codex_web
cp config.example.json config.json
```

然后编辑 `config.json`。不要把真实 API Key、内网地址、个人目录或模型路径提交到代码仓库。

端口配置以 `config.json` 为唯一来源。`server.port`、`frontend.port`、`frontend.httpsPort` 都是必填项；源码和启动脚本不会再内置默认端口。修改端口后，重启后端和前端即可生效。

常用配置项：

| 字段 | 说明 |
| --- | --- |
| `openai.apiKey` | OpenAI 或兼容服务的 API Key。也可以用 `OPENAI_API_KEY` 环境变量覆盖。 |
| `openai.baseUrl` | OpenAI 或兼容服务的 API Base URL。也可以用 `OPENAI_BASE_URL` 环境变量覆盖。 |
| `openai.model` | Codex 默认使用的模型。 |
| `chatModel` | routing、managed progress/general answer 使用的轻量模型配置，可独立设置 `apiKey`、`baseUrl`、`model`、`modelReasoningEffort`、`approvalPolicy`、`sandboxMode`、`skipGitRepoCheck`。 |
| `codex.approvalPolicy` | Codex approval policy，例如 `never`、`on-request`。 |
| `codex.sandboxMode` | Codex sandbox mode，例如 `workspace-write`、`danger-full-access`。 |
| `codex.sandboxWorkspaceWriteNetworkAccess` | 当 `sandboxMode` 为 `workspace-write` 时是否允许 Agent 命令访问网络；需要连接本机 FreeCAD RPC 或 COMSOL 私有 `mphserver` 时应设为 `true`。 |
| `server.port` | 后端端口，必填。也可以用 `BACKEND_PORT` 环境变量临时覆盖。 |
| `server.host` | 后端监听地址，例如 `0.0.0.0` 或 `127.0.0.1`。 |
| `server.corsOrigin` | 可选。允许访问后端的前端 origin 列表；不配置时会根据 `frontend.port`、`frontend.httpsPort`、`frontend.publicHost` 自动生成。 |
| `frontend.host` | 前端 Vite 服务监听地址，例如 `0.0.0.0`。 |
| `frontend.publicHost` | 前端对外访问主机名或 IP，用于启动脚本输出访问 URL 和自动 CORS；监听 `0.0.0.0` 时建议配置。 |
| `frontend.port` | 前端 HTTP 开发端口，必填。 |
| `frontend.httpsPort` | 前端 HTTPS 开发端口，必填；启动脚本默认启动 HTTPS 端口。 |
| `frontend.strictPort` | 是否要求 Vite 只使用配置端口，建议保持 `true`，避免端口漂移。 |
| `workspace.templateDir` | 示例输入/工作区模板根目录，例如 `open_codex_web/data/input_data`。 |
| `workspace.filesystemGroup` | 创建/写入工作区文件时尝试设置的文件系统组；应配置为运行后端用户所属的组。 |
| `workspace.usersRoot` | 用户工作区根目录，例如 `/data/lbk/codex_web/data/users`；旧字段 `auth.usersDir` 仍作为兼容 fallback。 |
| `workspace.rpcHost` / `workspace.rpcPort` | FreeCAD 远程 RPC 配置。 |
| `tools.remoteDesktopLauncher` | 后端 `/api/remote-tools/ensure-desktops` 启动 FreeCAD/ParaView 远程桌面的统一 launcher。 |
| `tools.cad/paraview/comsol.displayNum` | 远程 GUI 工具使用的 X display，例如 `:1`、`:2`、`:32`。 |
| `tools.cad/paraview/comsol.vncPort` | 远程 GUI 工具本地 VNC 端口。 |
| `tools.cad/paraview/comsol.noVncPort` | 远程 GUI 工具 noVNC 端口，前端 iframe 和后端端口检查都会读取这里。 |
| `tools.cad/paraview/comsol.launcher` | 远程 GUI 工具启动脚本路径；后端直接使用 `tools.comsol.launcher` 启动 COMSOL。 |
| `tools.cad.bin` | `start_remote_gui_tools.sh` 直接启动 FreeCAD GUI 时使用的可执行文件路径；也可以用 `FREECAD_BIN` 环境变量临时覆盖。 |
| `tools.comsol.sudo` | 调用 COMSOL launcher 时使用的提权命令，默认 `sudo`。 |
| `gnc.dashboard.telemetryPaths` | GNC 看板读取的遥测文件相对路径。 |
| `whisper.*` | 语音转写相关配置；不用语音功能时可以保留占位值或设为 `null`。 |
| `cosyvoice.*` | TTS 服务配置；不用语音播报时可以保留占位值或设为 `null`。 |
| `logging.*` | 日志级别、日志文件和是否输出到控制台。 |

## 安装依赖

```bash
cd /path/to/open_codex_web/backend
npm install

cd /path/to/open_codex_web/frontend
npm install
```

如果要运行 Codex Agent，请确保本机可以执行 `codex`：

```bash
npm install -g @openai/codex
codex --version
```

## 启动项目

推荐使用根目录启动脚本：

```bash
cd /path/to/open_codex_web
./start_open_codex_web.sh
```

脚本会读取 `config.json`，关闭旧的 `ocw-backend*` 和 `ocw-frontend*` tmux 会话，释放后端端口，然后分别启动后端和前端。

启动成功后，脚本会输出类似：

```text
backend:  http://localhost:<server.port>  tmux=ocw-backend
frontend: https://<frontend.publicHost 或 frontend.host>:<frontend.httpsPort>  tmux=ocw-frontend
```

也可以手动分别启动：

```bash
cd /path/to/open_codex_web/backend
BACKEND_PORT="$(node -p "require('../config.json').server.port")" npm run dev
```

```bash
cd /path/to/open_codex_web/frontend
npm run dev:https -- --host "$(node -p "require('../config.json').frontend.host")" --port "$(node -p "require('../config.json').frontend.httpsPort")" --strictPort
```

前端 Vite 代理会读取同一个 `config.json` 的 `server.port`。如果手动用 `BACKEND_PORT` 覆盖后端端口，也要给前端启动命令传入相同的 `BACKEND_PORT`。

## Agent CLI 模块

后端启动 Codex Agent 时会把仓库内置的 FreeCAD 和仿真 CLI 源码目录加入该次运行的 `PYTHONPATH`，并授权给 Codex 读取：

```text
backend/workflow_agents/agents/freecad_cli_tools/src
backend/workflow_agents/agents/sim_cli_tools/src
```

因此技能里应直接使用：

```bash
python -m freecad_cli_tools.cli.main ...
python -m sim_cli_tools.cli.main ...
```

如果出现 `ModuleNotFoundError: freecad_cli_tools` 或 `ModuleNotFoundError: sim_cli_tools`，优先检查后端是否已重启到最新代码，以及 Agent 命令中的 `PYTHONPATH` 是否包含上述两个 `src` 目录。不要依赖机器上全局安装的 `freecad-tools`、`sim-run` 或旧仓库的 editable install；它们可能指向过期路径。

## 构建检查

```bash
cd /path/to/open_codex_web/backend
npm run build

cd /path/to/open_codex_web/frontend
npm run build
```

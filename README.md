# Agent Web

Agent Web 是一个由 React 前端和 Fastify 后端组成的 Agent 工程工作台。项目通过根目录下的 `config.json` 读取模型、服务端口、工作区、语音和远程工具配置。

## 配置文件

项目不会自动创建真实配置。第一次启动前，请复制示例配置：

```bash
cd /path/to/agent-web
cp config.example.json config.json
```

然后编辑 `config.json`。`config.example.json` 中值为 `xxx` 的字段必须按本机环境填写；相邻的 `_...Comment` 字段只是填写说明，复制到真实配置后可以保留，也可以删除。不要把真实 API Key、内网地址、个人目录或模型路径提交到代码仓库。

端口配置以 `config.json` 为唯一来源。`server.port`、`frontend.port`、`frontend.httpsPort` 都是必填项；源码和启动脚本不会再内置默认端口。修改端口后，重启后端和前端即可生效。

常用配置项：

| 字段 | 说明 |
| --- | --- |
| `chatModel` | 默认内网模型连接配置，可设置 `apiKey`、`baseUrl`、`model`。环境变量 `CHAT_MODEL_API_KEY`、`CHAT_MODEL_BASE_URL`、`CHAT_MODEL_NAME` 可覆盖。 |
| `openai` | OpenAI 后端连接配置，可设置 `apiKey`、`baseUrl`、`model`。环境变量 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 可覆盖。 |
| `_...Comment` | 仅用于 `config.example.json` 的填写提示，后端会忽略这些字段。 |
| `codex.modelProvider` / `codex.wireApi` | Codex SDK provider 元数据，例如 `nexahub` 和 `responses`。 |
| `codex.modelReasoningEffort` | Codex 推理强度，例如 `low`、`medium`、`high`。 |
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
| `workspace.templateDir` | 示例输入/工作区模板根目录，例如 `agent-web/data/input_data`。 |
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
| `funasr.*` | 语音转写相关配置；不用语音功能时可以保留占位值或设为 `null`。 |
| `cosyvoice.*` | TTS 服务配置；不用语音播报时可以保留占位值或设为 `null`。 |
| `logging.*` | 日志级别、日志文件和是否输出到控制台。 |

## 安装依赖

推荐直接使用根目录启动脚本，它会在启动前自动检查并安装前后端 npm 依赖：

```bash
./start_agent_web.sh
```

也可以手动安装：

```bash
cd /path/to/agent-web/backend
npm install

cd /path/to/agent-web/frontend
npm install
```

如果要运行 Agent 任务，请确保本机可以执行 `codex`：

```bash
npm install -g @openai/codex
codex --version
```

## 启动项目

推荐使用根目录启动脚本：

```bash
cd /path/to/agent-web
./start_agent_web.sh
```

脚本会先运行 `scripts/validate_config.mjs --config config.json` 校验真实配置文件，集中提示占位值、字段类型、路径/可执行文件以及模型、FunASR、CosyVoice、数据库等外部服务连接问题。校验通过后，脚本会检查 npm 依赖、关闭旧的 `ocw-backend*` 和 `ocw-frontend*` tmux 会话、释放配置端口、启动远程 GUI 工具，然后分别启动后端和前端。

`start_agent_web.sh` 是薄入口，实际步骤拆在 `scripts/` 下：

| 脚本 | 作用 |
| --- | --- |
| `scripts/validate_start_config.sh` | 启动前校验 `config.json`。 |
| `scripts/install_node_deps.sh` | 对 `backend` 和 `frontend` 执行 `npm install --no-audit --no-fund`。 |
| `scripts/restart_web_services.sh` | 停旧 tmux、释放端口、启动远程 GUI、重启前后端服务。 |
| `scripts/start_common.sh` | 上述脚本共享的配置读取、端口和 tmux 工具函数。 |

也可以手动只做配置校验：

```bash
node scripts/validate_config.mjs --config config.json
```

如果只是本地调试，可以临时跳过外部服务连通性检查：

```bash
SKIP_CONFIG_SERVICE_CHECKS=1 ./start_agent_web.sh
```

完整跳过启动前校验：

```bash
SKIP_CONFIG_VALIDATE=1 ./start_agent_web.sh
```

启动成功后，脚本会输出类似：

```text
backend:  http://localhost:<server.port>  tmux=ocw-backend
frontend: https://<frontend.publicHost 或 frontend.host>:<frontend.httpsPort>  tmux=ocw-frontend
```

也可以手动分别启动：

```bash
cd /path/to/agent-web/backend
BACKEND_PORT="$(node -p "require('../config.json').server.port")" npm run dev
```

```bash
cd /path/to/agent-web/frontend
npm run dev:https -- --host "$(node -p "require('../config.json').frontend.host")" --port "$(node -p "require('../config.json').frontend.httpsPort")" --strictPort
```

前端 Vite 代理会读取同一个 `config.json` 的 `server.port`。如果手动用 `BACKEND_PORT` 覆盖后端端口，也要给前端启动命令传入相同的 `BACKEND_PORT`。

## 远程 GUI 工具

远程 GUI 仍通过根目录入口调用：

```bash
./start_remote_gui_tools.sh start
./start_remote_gui_tools.sh status
./start_remote_gui_tools.sh restart
./start_remote_gui_tools.sh stop
```

`start_remote_gui_tools.sh` 也是薄入口，实际逻辑拆在 `scripts/` 下：

| 脚本 | 作用 |
| --- | --- |
| `scripts/remote_gui_common.sh` | 读取 `config.json`，加载 DISPLAY/VNC/noVNC/RPC 配置和公共函数。 |
| `scripts/remote_gui_desktop.sh` | 管理 Xvfb、openbox、x11vnc、noVNC。 |
| `scripts/remote_gui_freecad_rpc.sh` | 管理 FreeCAD RPC、端口占用检查和 FreeCAD 启动。 |
| `scripts/remote_gui_runtime.sh` | 编排 `start`、`stop`、`restart`、`status`。 |

这些脚本仍读取 `tools.cad/paraview/comsol.*`、`workspace.rpcHost` 和 `workspace.rpcPort`，对外命令不变。

## Agent CLI 模块

后端启动 Agent 任务时会把仓库内置的 FreeCAD 和仿真 CLI 源码目录加入该次运行的 `PYTHONPATH`，并授权给 Agent 读取：

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
cd /path/to/agent-web/backend
npm run build

cd /path/to/agent-web/frontend
npm run build
```

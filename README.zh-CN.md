# Open Codex Web

Open Codex Web 是一个由 React 前端和 Fastify 后端组成的 Codex 工程工作台。项目通过根目录下的 `config.json` 读取 OpenAI/Codex、服务端口、工作区、语音和远程工具配置。

## 配置文件

项目不会自动创建真实配置。第一次启动前，请复制示例配置：

```bash
cd /path/to/open_codex_web
cp config.example.json config.json
```

然后编辑 `config.json`。不要把真实 API Key、内网地址、个人目录或模型路径提交到代码仓库。

常用配置项：

| 字段 | 说明 |
| --- | --- |
| `openai.apiKey` | OpenAI 或兼容服务的 API Key。也可以用 `OPENAI_API_KEY` 环境变量覆盖。 |
| `openai.baseUrl` | OpenAI 或兼容服务的 API Base URL。也可以用 `OPENAI_BASE_URL` 环境变量覆盖。 |
| `openai.model` | Codex 默认使用的模型。 |
| `codex.workingDirectory` | Codex 任务默认运行目录。 |
| `codex.approvalPolicy` | Codex approval policy，例如 `never`、`on-request`。 |
| `codex.sandboxMode` | Codex sandbox mode，例如 `workspace-write`、`danger-full-access`。 |
| `server.port` | 后端端口。也可以用 `BACKEND_PORT` 环境变量覆盖。 |
| `server.corsOrigin` | 允许访问后端的前端地址列表。 |
| `frontend.host` | 前端 Vite 服务监听地址。 |
| `frontend.port` | 前端 HTTP 开发端口。 |
| `frontend.httpsPort` | 前端 HTTPS 开发端口，启动脚本默认使用这个端口。 |
| `workspace.workspaceDir` | 默认工程工作区目录。启动脚本要求该字段非空。 |
| `workspace.rpcHost` / `workspace.rpcPort` | FreeCAD 远程 RPC 配置。 |
| `tools.*.noVncPort` | CAD、ParaView、COMSOL 等远程 GUI 工具的 noVNC 端口。 |
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
frontend: https://<host>:<frontend.httpsPort>  tmux=ocw-frontend
```

也可以手动分别启动：

```bash
cd /path/to/open_codex_web/backend
npm run dev
```

```bash
cd /path/to/open_codex_web/frontend
npm run dev:https -- --host 0.0.0.0 --port 5175 --strictPort
```

## 构建检查

```bash
cd /path/to/open_codex_web/backend
npm run build

cd /path/to/open_codex_web/frontend
npm run build
```


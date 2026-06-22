# Open Codex Web

Open Codex Web 是一个面向工程工作区的 Codex Web 前端与 Fastify 后端。当前项目已经不只是早期的聊天页面，而是集成了工作区版本管理、Agent 语音/文字任务、运行进度、文件浏览、三维模型、远程 GUI 工具、GNC 配置编辑与 GNC 遥测看板的工程工作台。

---

## 当前功能

- **Codex Agent 对话**：支持普通 SSE 任务流与托管任务流，能够绑定工作区、版本、线程和会话。
- **Agent 工作台**：`/agent` 页面提供工作区、配置/BOM、模型、工具、文件、语音交互和进度面板。
- **工作区版本树**：通过 workspace manifest 管理工作区版本、父子分支、兄弟分支、checkout、artifact、checkpoint、score 和 run 状态。
- **GNC 工作流**：支持 GNC 工作区根目录、42 配置解析/编辑、外部 GNC 页面和本地 D3 遥测看板。
- **热仿真工作流**：保留 FreeCAD、ParaView、COMSOL 远程工具和热仿真工作区数据读取能力。
- **文件与日志**：支持工作区文件树、文本/二进制预览、压缩下载、阶段日志、对话日志和进度文件读取。
- **语音能力**：FunASR HTTP 语音转写、CosyVoice TTS、Agent 语音任务反馈。
- **三维查看器**：`/viewer` 页面读取工作区 GLB 或模型接口，使用 Three.js/WebGPU 展示模型。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、TypeScript、Vite、D3、Three.js、Shiki、i18next |
| 后端 | Fastify 5、TypeScript、tsx、@openai/codex-sdk |
| Agent | Codex SDK、Codex CLI、workflow skill contracts |
| 语音 | FunASR HTTP 转写服务、CosyVoice HTTP 服务 |
| 工作区 | 本地文件系统、workspace manifest、session store、progress/log artifacts |

---

## 目录结构

```text
open_codex_web/
├── backend/
│   ├── src/
│   │   ├── index.ts                 # Fastify 入口，加载根 config.json 并注册全部 API
│   │   ├── server/routes.ts         # API 聚合注册
│   │   ├── codex-run/               # /api/run 与 /api/run/managed/*
│   │   ├── manifests/               # workspace manifest、版本、run、artifact 注册
│   │   ├── workspaces/              # 工作区列表、文件、BOM、模型、进度、日志
│   │   ├── sessions/                # 会话存储与会话 REST API
│   │   ├── gnc_config/              # 42 GNC 配置解析与写回
│   │   ├── system/                  # health、skills、remote tools
│   │   ├── funasr/                  # FunASR 转写代理与语音转 Codex
│   │   └── cosyvoice/               # TTS 与任务提示音
│   ├── workflow_agents/
│   │   ├── gnc_skills/              # AIGNC/42 相关 Codex skills 和 plot_runtime_gnc.py
│   │   ├── thermal_skills/          # 热仿真、FreeCAD、仿真相关 skills
│   │   ├── check_skills/            # 降额检查等 skills
│   │   └── agents/                  # freecad_cli_tools、sim_cli_tools
├── data/
│   ├── voice_input/                 # TTS prompt wav 与任务提示音
│   ├── voice_output/                # Web 侧保存的 TTS 生成音频
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # 前端轻量路由分发
│   │   ├── pages/
│   │   │   ├── AgentPage.tsx        # /agent 主工作台
│   │   │   ├── WorkspacePageShell.tsx
│   │   │   ├── GncWorkspacePage.tsx # /gnc-workspace，复用 shell
│   │   │   ├── WorkspaceSessionPage.tsx
│   │   │   ├── RegionWorkspacePage.tsx
│   │   │   ├── ModelViewerPage.tsx
│   │   │   └── workspace/
│   │   │       ├── GncDashboardPanel.tsx
│   │   │       └── GncTelemetryCharts.tsx
│   │   ├── pages/agent/             # Agent 侧栏、工具面板、录音、文件视图等
│   │   └── app/                     # API base、session、workspace 配置工具
│   ├── gnc_config/                  # GNC 配置编辑器组件与样式
│   └── vite.config.ts
├── data/                            # 提示音、示例输入数据等
├── start_remote_gui_tools.sh        # GUI 工具启动/状态/重启脚本
└── package-lock.json
```

项目根目录 `config.json` 是运行配置主文件；`start_open_codex_web.sh` 是推荐启动脚本。

---

## 配置

后端和前端都读取项目根目录 `config.json`。端口配置以该文件为唯一来源；`server.port`、`frontend.port`、`frontend.httpsPort` 都是必填项，源码和启动脚本不会再内置默认端口。关键字段：

| 字段 | 说明 |
|------|------|
| `chatModel` / `CHAT_MODEL_*` | 默认内网模型连接配置，可设置 `apiKey`、`baseUrl`、`model` |
| `openai` / `OPENAI_*` | OpenAI 后端连接配置，可设置 `apiKey`、`baseUrl`、`model` |
| `codex.modelProvider` / `codex.modelProviderName` / `codex.wireApi` / `codex.supportsWebsockets` | Codex SDK provider 元数据 |
| `codex.modelReasoningEffort` | 推理强度 |
| `codex.approvalPolicy` | Codex approval policy |
| `codex.sandboxMode` | Codex sandbox mode |
| `codex.sandboxWorkspaceWriteNetworkAccess` | `workspace-write` 沙箱下是否允许 Agent 命令访问网络；连接本机 FreeCAD RPC 或 COMSOL 私有 `mphserver` 时需要设为 `true` |
| `server.port` / `BACKEND_PORT` | 后端端口，必填；环境变量可临时覆盖 |
| `server.host` | 后端监听地址 |
| `server.corsOrigin` | 可选，允许访问后端的前端 origin 列表；不配置时根据 `frontend.port`、`frontend.httpsPort`、`frontend.publicHost` 自动生成 |
| `frontend.host` | Vite 监听地址 |
| `frontend.publicHost` | 前端对外访问主机名或 IP，用于启动脚本输出 URL 和自动 CORS |
| `frontend.port` | HTTP 开发端口，必填 |
| `frontend.httpsPort` | HTTPS 开发端口，必填 |
| `frontend.strictPort` | 是否要求 Vite 只使用配置端口，建议保持 `true` |
| `tools.remoteDesktopLauncher` | 后端确保 FreeCAD/ParaView 远程桌面启动时调用的统一 launcher |
| `tools.cad/paraview/comsol.displayNum` | 远程 GUI 工具使用的 X display |
| `tools.cad/paraview/comsol.vncPort` | 远程 GUI 工具本地 VNC 端口 |
| `tools.cad/paraview/comsol.noVncPort` | 前端工具面板和后端端口检查使用的 noVNC 端口 |
| `tools.cad/paraview/comsol.launcher` | 远程 GUI 工具启动脚本路径；COMSOL 后端接口直接调用 `tools.comsol.launcher` |
| `tools.cad.bin` | `start_remote_gui_tools.sh` 直接启动 FreeCAD GUI 时使用的可执行文件路径；可用 `FREECAD_BIN` 临时覆盖 |
| `tools.comsol.sudo` | 调用 COMSOL launcher 时使用的提权命令，默认 `sudo` |
| `tools.cad/paraview/comsol.url` | 可选，直接覆盖工具 iframe URL |
| `tools.gnc.url` | 外部 GNC 页面 URL |
| `gnc.dashboard.telemetryPaths` | GNC 看板 CSV 遥测路径 |
| `gnc.dashboard.telemetryMaxBytes` | GNC 看板单文件读取上限 |
| `workspace.templateDir` | 示例输入/工作区模板根目录，例如 `open_codex_web/data/input_data` |
| `workspace.filesystemGroup` | 新建 workspace/version 目录和 manifest 文件的 Linux 文件系统 group，应配置为后端运行用户所属的组，可用 `WORKSPACE_FILESYSTEM_GROUP` 覆盖 |
| `workspace.usersRoot` | 用户工作区根目录，例如 `/data/lbk/codex_web/data/users`；旧字段 `auth.usersDir` 仍作为兼容 fallback |
| `workspace.rpcHost` / `workspace.rpcPort` | FreeCAD MCP RPC 连接配置 |
| `workspace.filePreviewMaxBytes` | 普通文件预览大小上限，可用 `WORKSPACE_FILE_PREVIEW_MAX_BYTES` 覆盖 |
| `workspace.textFileMaxBytes` | 文本文件整读上限，可用 `WORKSPACE_TEXT_FILE_MAX_BYTES` 覆盖 |
| `workspace.textChunkBytes` / `workspace.textChunkMaxBytes` | 超大文本/JSON 分块读取默认块大小和单块上限，可用 `WORKSPACE_TEXT_CHUNK_BYTES` / `WORKSPACE_TEXT_CHUNK_MAX_BYTES` 覆盖 |
| `funasr.apiUrl` | FunASR HTTP 转写服务地址 |
| `cosyvoice.apiUrl` / `cosyvoice.promptWav` / `cosyvoice.promptText` | CosyVoice 服务与零样本提示配置 |
| `cosyvoice.streamCacheTtlMs` / `cosyvoice.streamCacheMaxItems` | TTS 流式缓存配置 |
| `cosyvoice.ttsMaxTextLength` | 单次 TTS 文本长度上限 |

不要把真实 API Key 写进 README、提交记录或日志。

### Qwen3.6 / chatModel 接入方式

当前代码没有为 `Qwen3.6` 写模型专用分支，而是把它作为默认 `chatModel` 后端的一种配置使用。`backend/src/modelBackends/modelBackends.ts` 定义了两个可选模型后端：`chatModel` 和 `openai`，默认值是 `chatModel`。普通 `/api/run`、托管 `/api/run/managed/*`、意图路由、进度总结和 general answer 都会通过 `resolveModelBackend(config, body.modelBackend)` 解析实际使用的 `apiKey`、`baseUrl`、`model`；Codex provider、wire API、sandbox 和 approval 策略统一从 `codex` 配置读取。当前 `config.json` 中 `chatModel.model` 配置为 `Qwen3.6`，因此默认 Agent 流程会使用该内网模型；前端 `/agent` 顶栏的“模型”开关可以在 `内网模型` 和 `OpenAI` 之间切换，请求体通过 `modelBackend` 传给后端。

为了适配 `Qwen3.6` 这类非 OpenAI 的 Responses-compatible 网关，后端新增了内部兼容代理 `POST /internal/codex/v1/responses`。当 `codex.wireApi` 为 `responses` 且 provider 不是 `openai` 时，Codex SDK 的 base URL 会被改到该内部代理。代理会将 Codex 请求改写成更容易被兼容网关接受的格式：删除部分顶层字段，丢弃 `instructions`，把 `developer` role 改为 `system`，前移并合并 system message，过滤非 function 工具和 `view_image`，并在大请求或上游 `5xx` 时尝试 compact/no-tool 重试。该路径同时会记录 request shape 和错误摘要，避免日志中输出完整消息内容。

`chatModel` 后端还启用了 compact skill instructions：显式启用 skill 时，首轮请求只注入 skill 名称、描述和 Source 文件路径，并要求 Agent 在真正使用前读取对应 `SKILL.md`，而不是直接把完整 skill 内容塞进上下文。这样可以降低 `Qwen3.6` 首轮请求体大小和兼容网关失败概率；切换到 `openai` 后端时仍保留完整 skill 内容注入。

---

## 安装依赖

```bash
cd /path/to/open_codex_web/backend
npm install

cd /path/to/open_codex_web/frontend
npm install
```

Codex SDK 需要本机能找到 `codex` 可执行文件：

```bash
npm install -g @openai/codex
codex --version
```

语音转写依赖 `funasr.apiUrl` 指向的 FunASR HTTP 服务，语音播报依赖 CosyVoice 服务；这些能力缺失时，不影响纯文字 Agent 和工作区页面启动。

---

## 启动

推荐从项目根目录使用统一脚本：

```bash
cd /path/to/open_codex_web
./start_open_codex_web.sh
```

该脚本会：

- 读取项目根目录 `config.json`。
- 关闭旧的 `ocw-backend*` / `ocw-frontend*` tmux 会话。
- 释放后端端口。
- 在 tmux 中启动后端 `npm run dev`。
- 在 tmux 中启动前端 `npm run dev:https`。

当前脚本输出形如：

```text
backend:  http://localhost:<server.port>  tmux=ocw-backend
frontend: https://<frontend.publicHost 或 frontend.host>:<frontend.httpsPort>  tmux=ocw-frontend
```

后端端口来自 `server.port`，前端 HTTPS 端口来自 `frontend.httpsPort`。不要假定固定端口。

手动调试也可以分开启动：

```bash
cd /path/to/open_codex_web/backend
BACKEND_PORT="$(node -p "require('../config.json').server.port")" npm run dev
```

```bash
cd /path/to/open_codex_web/frontend
npm run dev:https -- --host "$(node -p "require('../config.json').frontend.host")" --port "$(node -p "require('../config.json').frontend.httpsPort")" --strictPort
```

前端 Vite 代理会读取同一个 `config.json` 的 `server.port`。如果手动用 `BACKEND_PORT` 覆盖后端端口，也要给前端启动命令传入相同的 `BACKEND_PORT`。

构建验证：

```bash
cd /path/to/open_codex_web/backend
npm run build

cd /path/to/open_codex_web/frontend
npm run build
```

---

## 前端页面

前端没有使用 React Router，而是在 `frontend/src/main.tsx` 根据 `window.location.pathname` 分流：

| 路径 | 页面 |
|------|------|
| `/`、`/home` | 首页 |
| `/agent` | Agent 工程工作台 |
| `/workspace` | 通用热仿真/工程工作区页面 |
| `/gnc-workspace` | GNC workspace shell，使用 `/api/gnc` 前缀 |
| `/region-workspace` | 区域/降额类工作区页面 |
| `/viewer` | Three.js/WebGPU 模型查看器 |
| `/earth` | 地球/轨道相关页面 |
| `/spline` | Spline bot 页面 |
| `/v3` | V3 页面 |

当前 GNC 看板已经集成在 `/agent` 的工具面板中；不要再把它作为独立的 `/gnc-workspace` 看板入口维护。

---

## Agent 页面

`/agent` 是当前主要入口。左侧功能项来自 `frontend/src/pages/agent/constants.ts`：

- `工作区`：选择工作区、查看版本树、创建子分支/兄弟分支、checkout。
- `BOM` / `配置文件`：普通工作区显示 BOM；GNC 工作区显示 42 配置编辑器。
- `模型`：打开 `/viewer` 并读取当前工作区模型。
- `工具`：嵌入远程 GUI 工具或 GNC 看板。
- `文件`：浏览工作区文件树并预览文件。

GNC 工作区识别逻辑在 `AgentPage.tsx` 中通过工作区标识匹配 `gnc`、`aignc`、`adcs`、`region` 等关键词。识别为 GNC 后：

- `BOM` 标签改为 `配置文件`。
- 工具面板增加 `GNC` 和 `GNC 看板`。
- 非 GNC 工作区会自动避免停留在 GNC 相关工具标签。

---

## GNC 工具与看板

`/agent` 的工具面板在 GNC 工作区下显示：

| 标签 | 内容 |
|------|------|
| CAD | noVNC：`http://<当前主机>:<tools.cad.noVncPort>/vnc.html?autoconnect=true&resize=scale&path=websockify` |
| ParaView | noVNC：`http://<当前主机>:<tools.paraview.noVncPort>/vnc.html?autoconnect=true&resize=scale&path=websockify` |
| COMSOL | noVNC：`http://<当前主机>:<tools.comsol.noVncPort>/vnc.html?autoconnect=true&resize=scale&path=websockify` |
| GNC | 外部页面，来自 `config.json` 的 `tools.gnc.url` |
| GNC 看板 | 本地前端 D3/SVG 遥测图表 |

GNC 看板不读取 Python 生成的 PNG，而是直接读取当前工作区运行数据并在前端渲染。入口文件：

- `frontend/src/pages/workspace/GncDashboardPanel.tsx`：读取 CSV 文本文件。
- `frontend/src/pages/workspace/GncTelemetryCharts.tsx`：解析遥测、计算派生量、渲染 D3/SVG 图表。

当前读取的工作区文件：

- `00_inputs/Output/Run/runtime_case/InOut/Sc.csv`
- `00_inputs/Output/Run/runtime_case/InOut/AcWhl.csv`
- `00_inputs/Output/Run/runtime_case/InOut/ModeTrace_SC0.csv`

渲染逻辑应与 `backend/workflow_agents/gnc_skills/42-runtime-plotter/scripts/plot_runtime_gnc.py` 保持一致，标准图包括：

- 本体角速度：`Sc_wn_1/2/3 * 180/pi`
- 惯性系姿态：`Sc_qn_1..4` 按 42 vector-first quaternion 转 `CBN`，再转 Euler-123。
- 轨道系姿态误差：由 `Sc_PosN_*`、`Sc_VelN_*` 构造 `CLN`，计算 `CBL = CBN * CLN^T` 后转 Euler-123。
- 飞轮转速：`Ac_Whl*_H / J * 60 / (2*pi)`，默认 `J = 0.00068209`。
- 模式时间线：`ModeTrace_SC0.csv` 的 `TimeSec`、`ModeId`、`Mode`。

图表约定：

- X 轴统一以小时显示。
- 每张图的 label/legend 固定在图表右上区域。
- 看板内不展示额外统计卡片或解释性信息。
- 图表字体和 legend 已按嵌入式面板尺寸压缩，避免遮挡曲线和模式标签。

---

## GNC 配置编辑

GNC 配置编辑器位于：

- `frontend/gnc_config/GncConfigEditor.tsx`
- `frontend/gnc_config/gnc_config.css`
- `backend/src/gnc_config/routes.ts`

后端接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/gnc-config` | 读取当前工作区 42 配置 |
| `PUT` | `/api/gnc-config` | 写回当前工作区 42 配置 |
| `GET` | `/api/gnc/gnc-config` | GNC 前缀版本 |
| `PUT` | `/api/gnc/gnc-config` | GNC 前缀版本 |

配置目录解析规则：

- 优先使用工作区 `00_inputs/Config`，如果其中存在 `Inp_Sim.txt`。
- 否则回退到 `00_inputs`。

---

## 后端 API 概览

所有 API 注册在 `backend/src/server/routes.ts`。后端还支持路径重写：

- `/api/gnc/*` 会重写到 `/api/*`，工作区模板根目录来自 `config.json` 的 `workspace.templateDir`，用户工作区根目录来自 `workspace.usersRoot`。
- `/api/region/*` 会重写到 `/api/*`，路径规则同上。

### Codex 运行

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/run` | 普通 SSE Codex turn |
| `POST` | `/api/run/input-files` | 上传/登记输入文件 |
| `POST` | `/api/run/managed/dispatch` | 启动绑定工作区的托管 Agent 任务 |
| `GET` | `/api/run/managed/latest` | 查询当前工作区最新托管任务 |
| `GET` | `/api/run/managed/status/:managedRunId` | 查询托管任务状态 |
| `GET` | `/api/run/managed/events/:managedRunId` | SSE 订阅托管任务事件 |
| `POST` | `/api/run/managed/cancel/:managedRunId` | 停止托管任务并总结 |
| `POST` | `/api/run/managed/summarize` | 总结当前或刚停止的任务进度 |

### 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sessions` | 读取会话列表 |
| `GET` | `/api/agent/messages` | 按 `sessionId` 和 `turnId` 读取最终 Agent 消息，供语音播放使用 |
| `PUT` | `/api/sessions/:id` | 增量写入单个 session |
| `POST` | `/api/sessions/:id` | `sendBeacon` 兼容写入，语义同 PUT |
| `DELETE` | `/api/sessions/:id` | 删除会话 |
| `POST` | `/api/sessions/:id/delete` | 删除会话的 POST fallback |
| `POST` | `/api/sessions` | 覆盖写入全部 sessions，最多 1000 条 |

### 工作区数据

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/workspace/workspaces` | 列出工作区 |
| `POST` | `/api/workspace/workspace` | 创建工作区 |
| `GET` | `/api/workspace/files/tree` | 读取工作区文件树 |
| `GET` | `/api/workspace/files/content` | 读取文件预览内容，默认 1MB |
| `GET` | `/api/workspace/files/text` | 读取较大文本文件，最高 8MB，GNC CSV 看板使用该接口 |
| `GET` | `/api/workspace/files/archive` | 下载工作区压缩包 |
| `GET` | `/api/workspace/component-info` | 读取几何组件信息 |
| `GET` | `/api/workspace/bom` | 读取 BOM |
| `GET` | `/api/workspace/progress` | 读取 `AIGNC_Workflow/loop_progress.json` 或 `logs/progress.json` |
| `GET` | `/api/workspace/temperature-field` | 读取热场数据 |
| `GET` | `/api/logs/stages` | 读取阶段日志 |
| `GET` | `/api/logs/conversation` | 读取对话日志 |
| `GET` | `/api/logs/conversation/latest` | 读取最新对话日志 |
| `GET` | `/api/workspace/model` | 解析当前工作区模型来源并返回模型 URL |
| `GET` | `/api/workspace/model/file` | 读取 GLB 模型文件 |

工作区查询参数通常包含：

| 参数 | 说明 |
|------|------|
| `workspaceDir` | 工作区版本目录 |
| `workspaceId` | 工作区 ID，可选 |
| `versionId` | 版本 ID，可选 |
| `relativePath` | 工作区内相对路径，文件接口使用 |
| `maxBytes` | 文件读取上限，文本接口最高 8MB |

示例：

```bash
BACKEND_PORT="$(node -p "require('./config.json').server.port")"
WORKSPACE_DIR="$(node -p "require('./config.json').workspace.usersRoot")/default/workspaces/ws_gnc/versions/v0001"
curl "http://localhost:${BACKEND_PORT}/api/workspace/files/text?workspaceDir=${WORKSPACE_DIR}&relativePath=00_inputs/Output/Run/runtime_case/InOut/Sc.csv"
```

### Workspace Manifest

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/workspace-manifest` | 按 workspaceKey/sessionId/workspaceDir 读取或初始化 manifest |
| `GET` | `/api/workspaces/:sessionId/manifest` | 旧 session 维度 manifest 入口 |
| `GET` | `/api/workspace-index/:workspaceId/manifest` | workspaceId 维度 manifest 入口 |
| `POST` | `/api/versions/:versionId/branch` | 从当前版本创建分支版本 |
| `POST` | `/api/versions/:versionId/checkout` | checkout 版本 |
| `POST` | `/api/versions/:versionId/commit` | 标记版本提交完成 |
| `POST` | `/api/versions/:versionId/fail` | 标记版本失败 |
| `GET` | `/api/versions/:a/diff/:b` | 比较两个版本 |
| `POST` | `/api/runs` | 创建 run |
| `GET` | `/api/runs/:runId` | 查询 run |
| `PATCH` | `/api/runs/:runId` | 更新 run |
| `POST` | `/api/runs/:runId/cancel` | 取消 run |
| `POST` | `/api/runs/:runId/retry` | 重试 run |
| `POST` | `/api/artifacts/register` | 注册 artifact |
| `POST` | `/api/versions/:versionId/artifacts/register` | 为版本注册 artifact |
| `POST` | `/api/checkpoints/register` | 注册 checkpoint |
| `POST` | `/api/scores/register` | 注册 score |

新建 workspace/version 时，后端会把 manifest 根目录、`versions/vNNNN` 目录、复制的 `00_inputs` 以及 `workspace_manifest.json` 的 Linux 文件系统 group 设置为 `workspace.filesystemGroup`（默认 `xieteam`），并对目录设置 setgid 位，使后续在这些目录下生成的文件尽量继承同一个 group。manifest/version record 中的 `group` 字段也默认写入 `xieteam`，用于前端和 API 元数据展示。

### 系统、语音和资源

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 后端、配置和 Codex 端点健康检查 |
| `GET` | `/api/skills` | 读取后端缓存的 skills |
| `POST` | `/api/remote-tools/ensure-desktops` | 确保 CAD/ParaView/COMSOL 远程桌面启动 |
| `GET` | `/api/image?path=...` | 安全读取本地图片 |
| `GET` | `/api/funasr/models` | 查看语音转写服务配置 |
| `POST` | `/api/funasr/transcribe` | 上传音频并转写 |
| `POST` | `/api/funasr/codex` | 转写文本后直接派发 Codex |
| `GET` | `/api/agent/audio/task-accepted` | 任务接受提示音 |
| `GET` | `/api/cosyvoice/config` | 查看 CosyVoice 配置 |
| `POST` | `/api/cosyvoice/tts` | 生成 TTS 音频文件 |
| `POST` | `/api/cosyvoice/tts-stream` | 直接流式返回 TTS 音频 |
| `GET` | `/api/cosyvoice/audio/:fileName` | 读取已生成音频 |

---

## 远程 GUI 工具

远程 GUI 工具由 `start_remote_gui_tools.sh`、`tools.remoteDesktopLauncher` 和各工具 `launcher` 管理。DISPLAY、VNC、noVNC 和 launcher 都来自 `config.json`：

| 工具 | DISPLAY | VNC | noVNC | 用途 |
|------|---------|-----|-------|------|
| FreeCAD | `tools.cad.displayNum` | `tools.cad.vncPort` | `tools.cad.noVncPort` | CAD 构建、模型校验、GUI MCP RPC |
| ParaView | `tools.paraview.displayNum` | `tools.paraview.vncPort` | `tools.paraview.noVncPort` | 热仿真结果查看 |
| COMSOL | `tools.comsol.displayNum` | `tools.comsol.vncPort` | `tools.comsol.noVncPort` | COMSOL 模型与仿真查看 |

常用命令：

```bash
./start_remote_gui_tools.sh start
./start_remote_gui_tools.sh status
./start_remote_gui_tools.sh restart
```

Agent 工具面板只负责 iframe 嵌入这些 noVNC 页面；远程桌面进程是否启动由后端系统接口和外部脚本保证。

FreeCAD CAD 构建仍应使用 GUI FreeCAD 的 MCP RPC，不使用 `freecadcmd` 代替。正常状态下：

- `tools.cad.noVncPort` 可访问。
- `tools.cad.vncPort` 返回 RFB 握手。
- FreeCAD GUI MCP RPC 监听 `workspace.rpcPort`。
- 进程列表中不应有 `freecadcmd`。

---

## Workflow Skills

后端启动时会扫描 `~/.codex/skills` 并刷新 `backend/skills.json`。项目内 workflow skill contract 位于 `backend/workflow_agents`：

- `gnc_skills`：AIGNC/42 场景理解、配置生成/校验、构建运行诊断、运行绘图、FSW 架构与代码等。
- `thermal_skills`：热仿真规划、配置编辑、FreeCAD、仿真运行与报告。
- `check_skills`：降额检查等规则类工作流。
- `routing_skills`：意图路由、进度总结等。

后端固定扫描 `backend/workflow_agents` 下的工作流 skills，托管 Agent 会结合工作区上下文和 enabled skills 运行。

---

## 常见问题

**启动后端提示配置文件不存在**  
确认项目根目录 `config.json` 存在。

**后端端口和 README 示例不同**  
以项目根目录 `config.json` 的 `server.port` 或环境变量 `BACKEND_PORT` 为准。当前统一脚本不会固定使用旧默认端口。

**前端访问被 CORS 拦截**  
优先配置 `frontend.publicHost`，后端会根据 `frontend.port` 和 `frontend.httpsPort` 自动生成 CORS origin。只有需要额外 origin 时，再手动设置 `server.corsOrigin`。

**GNC 看板没有图**  
检查当前工作区版本目录下是否存在 `Sc.csv`、`AcWhl.csv`、`ModeTrace_SC0.csv`，并确认 `/api/workspace/files/text` 能读取这些文件。

**GNC 工具外部页面打不开**  
`GNC` 标签使用 `tools.gnc.url`，需要该服务本身可从浏览器所在机器访问。

**语音转写不可用**  
检查 `FUNASR_API_URL` / `funasr.apiUrl` 指向的 FunASR HTTP 转写服务是否可用。纯文字 Agent 不依赖这些配置。

**TTS 不出声**  
检查 `COSYVOICE_API_URL`、`COSYVOICE_PROMPT_WAV` 和本地 CosyVoice 服务是否可访问。

**远程 CAD/ParaView/COMSOL 是空白**  
先运行 `start_remote_gui_tools.sh status`，再通过对应 noVNC 端口检查。Agent 只是嵌入工具窗口，不会替代底层 GUI 启动。

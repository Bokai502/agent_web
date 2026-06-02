# Codex Web

基于 OpenAI Codex SDK 的 Web 聊天界面，风格类似 ChatGPT。支持多会话管理、对话历史持久化，实时展示 Agent 的思考过程、命令执行和文件变更。

---

## 功能特性

- **流式输出**：SSE 实时推送 Codex 事件，AI 回复带打字机动画
- **多会话管理**：左侧边栏按日期分组管理对话，支持新建/切换/删除
- **对话历史持久化**：双层存储——`localStorage`（即时读取）+ 后端 `sessions.json`（持久化主存储）
- **多轮对话**：通过 Codex SDK `resumeThread` 保持对话上下文
- **命令执行展示**：内联显示执行的 Shell 命令和输出
- **文件变更展示**：显示 Agent 读写的文件列表
- **局域网访问**：可在同一局域网内的其他设备上访问

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Fastify + TypeScript + tsx |
| Agent | @openai/codex-sdk + codex 二进制 |
| 持久化 | localStorage（缓存）+ sessions.json（主存储） |

---

## 前置要求

### 1. Node.js

需要 **Node.js 18+**（推荐 20+）。

```bash
node --version
```

### 2. Codex 二进制

`@openai/codex-sdk` 需要 `codex` 可执行文件。通过 npm 全局安装：

```bash
# 全局安装（推荐）
npm install -g @openai/codex

# 安装后验证
codex --version
```

Windows 用户若遇到问题，可单独安装平台包：

```bash
npm install -g @openai/codex-win32-x64
```

---

## 配置

### API Key 与 Base URL

后端通过环境变量读取 API 配置，启动前在终端中设置：

**Windows（CMD）**
```cmd
set OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
set OPENAI_BASE_URL=https://api.openai.com/v1
```

**Windows（PowerShell）**
```powershell
$env:OPENAI_API_KEY = "sk-xxxxxxxxxxxxxxxx"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
```

**macOS / Linux**
```bash
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxx"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

> `OPENAI_BASE_URL` 为可选项，不设置则使用 OpenAI 官方地址。  
> 若使用第三方代理，将 Base URL 替换为代理地址即可。

### Codex 本地配置文件（可选）

Codex 会读取 `~/.codex/config.toml`，可在此配置默认模型：

```toml
model = "o3-mini"
model_reasoning_effort = "medium"

[model_providers.custom]
name = "custom"
wire_api = "responses"
base_url = "https://your-proxy.example.com"
```

---

## 安装依赖

```bash
# 后端
cd codex_web/backend
npm install

# 前端
cd ../frontend
npm install
```

---

## 启动

推荐从仓库根目录一条命令同时拉起前后端：

```bash
cd /data/lbk/codex_web
./start_open_codex_web.sh
```

该脚本会读取根目录 `config.json`，通过 tmux 启动后端和前端，并注入 FreeCAD 相关配置。默认地址：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5174`

### 终端 1 — 后端

如果需要手动调试，也可以分别启动两个服务：

```bash
cd /data/lbk/codex_web/open_codex_web/backend
set OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx   # Windows CMD
npm run dev
```

成功后输出：
```
Backend running on http://localhost:3001
```

### 终端 2 — 前端

```bash
cd /data/lbk/codex_web/open_codex_web/frontend
npm run dev
```

成功后输出：
```
  VITE ready in xxx ms

  ➜  Local:   http://localhost:5174/
  ➜  Network: http://192.168.x.x:5174/
```

打开浏览器访问 `http://localhost:5174` 即可使用。

如需验证 WebGPU 等依赖安全上下文的能力，可使用 HTTPS 开发模式：

```bash
cd /data/lbk/codex_web/open_codex_web/frontend
npm run dev:https
```

成功后访问 `https://localhost:5175` 或 `https://<你的局域网 IP>:5175`。首次打开时浏览器会提示本地自签名证书，信任后即可继续。

后端 CORS 通过根目录 `/data/lbk/codex_web/config.json` 的 `server.corsOrigin` 配置。默认已放行本地和当前局域网 HTTP 开发源。
如果你需要从其他域名或局域网 HTTPS 地址直连后端，再把对应 origin 加到根目录 `/data/lbk/codex_web/config.json` 的 `server.corsOrigin` 数组里即可。

### 局域网访问

前端已配置监听 `0.0.0.0`，同一局域网内的其他设备可通过 Network 地址访问：

```
http://192.168.x.x:5174
```

---

## CAD 与热仿真远程工具

本项目的 CAD 与热仿真流程依赖本机 GUI 工具的远程桌面展示。当前约定如下：

| 工具 | DISPLAY | VNC | noVNC | 说明 |
|------|---------|-----|-------|------|
| FreeCAD | `:1` | `5901` | `6080` | CAD 构建和校验通过 GUI FreeCAD MCP RPC `9877` 执行 |
| ParaView | `:2` | `5902` | `6081` | 热仿真 `native.vtu` 结果展示 |
| COMSOL | `:32` | `5932` | `6082` | 热仿真 `work.mph` 结果展示 |

远程工具统一启动脚本：

```bash
/data/lbk/codex_web/open_codex_web/start_remote_gui_tools.sh start
/data/lbk/codex_web/open_codex_web/start_remote_gui_tools.sh status
/data/lbk/codex_web/open_codex_web/start_remote_gui_tools.sh restart
```

Agent 页面触发远程桌面时会调用 `/usr/local/bin/start-remote-cad-desktop <tool> start`。该入口已改为幂等启动：`start` 只补齐缺失的 `Xvfb`、`x11vnc`、noVNC 组件，不会因为已有 GUI 进程而关闭当前 `6080/6081/6082` 会话；只有 `stop` 或 `restart` 才会主动关闭会话。

### FreeCAD CAD 构建

CAD 构建必须使用 GUI FreeCAD 的 MCP RPC，不使用 `freecadcmd`、headless RPC 或其他替代进程。正常状态下：

- `6080` 返回 noVNC 页面。
- `5901` 返回 VNC 握手 `RFB 003.008`。
- `9877` 由 GUI `freecad` 进程监听。
- 进程列表中不应有 `freecadcmd`。

常用检查：

```bash
ss -ltnp '( sport = :6080 or sport = :5901 or sport = :9877 )'
curl -I --max-time 3 http://127.0.0.1:6080/vnc.html
timeout 2 bash -lc 'exec 3<>/dev/tcp/127.0.0.1/5901; dd bs=12 count=1 <&3 2>/dev/null | od -An -tc'
ps -eo pid=,ppid=,user=,comm=,args= | awk '($0 ~ /freecadcmd/) || ($0 ~ /freecad/) || ($0 ~ /FreeCAD/) || ($0 ~ /9877/) {print}'
```

如果 `9877` 被其他进程占用过，FreeCAD MCP 插件可能只在 GUI 启动时自动尝试一次，失败后不会自动重试。处理方式是先释放 `9877`，再只重启 GUI FreeCAD，让 MCP 插件重新监听 `9877`；不要启动 `freecadcmd`。

示例构建命令：

```bash
PYTHONPATH=/data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/freecad_cli_tools/src \
FREECAD_RPC_HOST=localhost \
FREECAD_RPC_PORT=9877 \
python3 -m freecad_cli_tools.cli.main cad build \
  --workspace-dir /data/lbk/codex_web/data/input_data/workspaces/ws_thermal/versions/v0007
```

`v0007` 验证结果：`cad build` 成功，输出 `01_cad/geometry_after.step`、`01_cad/geometry_after.glb` 和 `01_cad/cad_agent_output.json`。

### 热仿真流程

热仿真使用 `sim-run`，从工作区的 `00_inputs` 与 `01_cad` 生成并运行 `02_sim`：

```bash
PYTHONPATH=/data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/sim_cli_tools/src:/data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/sim_cli_tools/runtime \
python3 -m sim_cli_tools.cli.main --json doctor \
  --workspace-dir /data/lbk/codex_web/data/input_data/workspaces/ws_thermal/versions/v0007
```

完整运行示例：

```bash
PYTHONPATH=/data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/sim_cli_tools/src:/data/lbk/codex_web/open_codex_web/backend/workflow_agents/agents/sim_cli_tools/runtime \
python3 -m sim_cli_tools.cli.main --json run \
  --workspace-dir /data/lbk/codex_web/data/input_data/workspaces/ws_thermal/versions/v0007 \
  --mph-port 32036 \
  --quiet \
  --async-open-tools
```

`v0007` 验证结果：

- `sim-run doctor` 通过，`missing_files: []`。
- `02_sim/run_manifest.json` 为 `ok: true`。
- `simulation_run`、`field_export`、`postprocess`、`case_build`、`analysis` 均为 `completed`。
- `02_sim/simulation/status.json` 为 `ok: true`，`stage: completed`。
- `02_sim/postprocess/render_summary.json` 为 `ok: true`，温度范围约 `243.91 K ~ 385.72 K`。
- `6081/5902` 与 `6082/5932` 均已验证可访问。

ParaView 展示脚本生成逻辑位于 `backend/workflow_agents/agents/sim_cli_tools/runtime/codex_agents/external_tool_launchers.py`。当前会自动选择 `T`、`Color` 或第一个可用数组进行着色，避免 `native.vtu` 温度数组名为 `Color` 时只按 `T` 着色导致“导入了但显示不正常”。

如果发现其他用户遗留的 COMSOL runtime 进程占用资源或干扰端口，可先确认不是当前 `lbk` 工作区运行，再终止对应用户的遗留进程。

---

## 项目结构

```
codex_web/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Fastify 服务器入口，监听 3001 端口
│   │   ├── routes/
│   │   │   ├── task.ts           # POST /api/run — SSE 流式对话接口
│   │   │   └── sessions.ts       # GET/POST /api/sessions — 会话持久化接口
│   │   └── types.ts
│   ├── sessions.json             # 会话历史数据（运行时生成，gitignore）
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/
    ├── src/
    │   ├── App.tsx               # 根组件，多会话状态管理 + 布局
    │   ├── types.ts              # ThreadEvent / ThreadItem / Session 类型
    │   ├── components/
    │   │   ├── Sidebar.tsx       # 左侧会话列表（按日期分组）
    │   │   ├── OutputLog.tsx     # 消息流展示（历史轮次 + 当前轮实时）
    │   │   └── TaskInput.tsx     # 底部输入栏（含发送/停止按钮）
    │   └── hooks/
    │       └── useTaskStream.ts  # SSE 流读取 Hook（含 onDone 提前触发优化）
    ├── index.html                # 含全局 CSS 变量、字体、keyframes
    └── vite.config.ts            # /api 反向代理到后端 3001
```

---

## 接口说明

### `POST /api/run`

接收用户输入，以 SSE 格式实时推送 Codex 事件流。

**请求体**
```json
{
  "prompt": "列出当前目录的文件",
  "threadId": "thread_abc123"
}
```

> `threadId` 为可选项。传入时调用 `resumeThread` 续接历史对话；不传时创建新线程。

**响应**（`text/event-stream`）

每行格式为 `data: <JSON>\n\n`，事件类型包括：

| 事件类型 | 说明 |
|----------|------|
| `thread.started` | 线程创建，含 `thread_id` 字段 |
| `turn.started` | 开始处理当前轮 |
| `item.started` | 新 item 开始（命令执行等） |
| `item.updated` | item 更新（命令输出追加） |
| `item.completed` | item 完成（agent 回复、命令完成） |
| `turn.completed` | 本轮完成 |
| `turn.failed` | 本轮出错 |
| `error` | 流级别错误 |

---

### `GET /api/sessions`

读取所有保存的会话历史。

**响应**（`application/json`）

```json
[
  {
    "id": "lc4z2p8j9a",
    "title": "列出当前目录的文件",
    "threadId": "thread_abc123",
    "turns": [...],
    "createdAt": 1744800000000
  }
]
```

---

### `POST /api/sessions`

覆盖写入所有会话历史（由前端在对话结束后自动调用）。

**请求体**：`Session[]` 数组（最大 1000 条，5MB 限制）

**响应**：`204 No Content`

---

## 数据模型

```typescript
interface Session {
  id: string           // 本地唯一 ID
  title: string        // 首条用户消息（前 60 字符）
  threadId: string | null  // Codex SDK thread_id，用于 resumeThread
  turns: Turn[]
  createdAt: number    // 时间戳
}

interface Turn {
  id: string           // 稳定唯一 ID（用作 React key）
  userPrompt: string
  events: ThreadEvent[]
}
```

---

## 常见问题

**Q: 启动后端报 `OPENAI_API_KEY not set`**  
A: 在同一终端窗口中先设置环境变量，再执行 `npm run dev`。

**Q: 报错 `系统找不到指定的文件` 或 `codex exec exited with code 1`**  
A: `codex` 二进制未找到。执行 `npm install -g @openai/codex` 后重试。

**Q: 前端提交后无任何响应**  
A: 检查后端终端是否有报错；确认 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 配置正确。

**Q: 局域网其他设备无法访问**  
A: 检查 Windows 防火墙是否放行了 `config.json` 中配置的前端端口，当前默认是 5174。

**Q: 刷新页面后历史对话消失**  
A: 确认后端正在运行，历史数据保存在 `backend/sessions.json`，通过 `/api/sessions` 接口读取。若后端未启动，前端会回退到 `localStorage` 缓存。

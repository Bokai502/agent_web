# open_codex_web 前后端 API 接口说明

本文档整理 `open_codex_web` 当前前端与后端之间的 HTTP API。后端基于 Fastify，主要路由注册入口为 `backend/src/server/routes.ts`；前端默认通过 `frontend/src/app/apiBase.ts` 的 `joinApiPath()` 拼接接口地址。

## 1. 基础约定

### 1.1 API Base

前端默认 API 前缀：

```ts
DEFAULT_API_BASE = "/api"
```

因此前端调用 `joinApiPath(apiBase, "/sessions")` 默认得到：

```text
/api/sessions
```

GNC 工作区页面传入：

```ts
apiBase = "/api/gnc"
```

后端会把 `/api/gnc/*` 重写为同名 `/api/*` 路由，但请求上下文会切换到 GNC 工作区根目录：

```text
/api/gnc/sessions -> /api/sessions
/api/gnc/workspace/bom -> /api/workspace/bom
```

### 1.2 Content-Type

除文件读取、模型文件、SSE 流接口外，业务接口通常使用：

```http
Content-Type: application/json
```

### 1.3 通用错误格式

多数接口失败时返回：

```json
{
  "error": "错误原因"
}
```

### 1.4 工作区定位参数

很多工作区接口支持以下 query/body 字段，用来定位具体工作区或版本：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `workspaceDir` | query/body | 工作区目录绝对路径或已解析目录 |
| `workspaceId` | query/body | manifest 中的工作区 ID |
| `versionId` | query/body | manifest 中的版本 ID |
| `sessionId` | query/body | 会话 ID，部分接口用于回退查找 |
| `workspaceKey` | query/body | 旧版/兼容定位键 |
| `sourceWorkspaceDir` | query | 初始化 manifest 时的源工作区目录 |

优先级由后端 `workspaceQuery.ts` 与 manifest store 决定。前端一般同时传 `workspaceId`、`versionId`、`workspaceDir`，以避免上下文歧义。

## 2. 系统接口

### 2.1 健康检查

```http
GET /api/health
```

检查后端到 Codex/OpenAI 兼容接口的连通性。后端会请求配置中的 `${baseUrl}/models`。

成功响应：

```json
{
  "ok": true,
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-5",
  "latencyMs": 123
}
```

失败响应状态码为 `503`，示例：

```json
{
  "ok": false,
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-5",
  "reason": "auth_failed",
  "status": 401
}
```

### 2.2 技能列表

```http
GET /api/skills
GET /api/gnc/skills
```

返回后端启动时扫描并缓存的 skills。`/api/gnc/skills` 会返回 GNC scope 下可用技能。

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/components/TaskInput.tsx` | 获取可选技能 |
| `frontend/src/components/AppleTaskComposer.tsx` | 组合输入时启用技能 |

## 3. 会话接口

会话数据结构对应前端 `frontend/src/types.ts` 的 `Session`：

```ts
interface Session {
  id: string
  title: string
  threadId: string | null
  turns: Turn[]
  createdAt: number
  dismissedAskUserId?: string | null
  workspaceId?: string | null
  versionId?: string | null
  workspaceDir?: string | null
  workspaceName?: string | null
}
```

### 3.1 读取所有会话

```http
GET /api/sessions
```

响应：

```json
[
  {
    "id": "session-1",
    "title": "创建热仿真模型",
    "threadId": "thread_xxx",
    "turns": [],
    "createdAt": 1760000000000,
    "workspaceId": "workspace-1",
    "versionId": "v1",
    "workspaceDir": "/data/..."
  }
]
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/app/sessionUtils.ts` | `apiLoad()` 拉取会话 |
| `frontend/src/hooks/useWorkspaceAppState.ts` | 页面初始化/刷新会话 |

### 3.2 增量写入单个会话

```http
PUT /api/sessions/:id
POST /api/sessions/:id
```

`POST` 版本用于兼容 `sendBeacon`。后端会按 turn id 合并 `turns`，避免多客户端整包覆盖。

请求体：

```json
{
  "id": "session-1",
  "title": "创建热仿真模型",
  "threadId": "thread_xxx",
  "turns": [
    {
      "id": "turn-1",
      "userPrompt": "开始建模",
      "events": []
    }
  ],
  "createdAt": 1760000000000
}
```

成功响应：

```http
204 No Content
```

### 3.3 删除单个会话

```http
DELETE /api/sessions/:id
POST /api/sessions/:id/delete
```

`POST /delete` 是兼容入口，前端优先使用它，失败后回退到 `DELETE`。

成功响应：

```http
204 No Content
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/hooks/useWorkspaceAppState.ts` | 删除会话 |

### 3.4 覆盖写入全部会话

```http
POST /api/sessions
```

请求体必须是数组，最多 1000 条，body 限制 5 MB。

成功响应：

```http
204 No Content
```

## 4. Codex 运行接口

### 4.1 上传输入图片

```http
POST /api/run/input-files
```

支持图片 MIME：

| MIME | 后缀 |
| --- | --- |
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/webp` | `.webp` |
| `image/gif` | `.gif` |

请求体：

```json
{
  "name": "panel.png",
  "mimeType": "image/png",
  "dataBase64": "iVBORw0KGgo..."
}
```

限制：

| 项 | 值 |
| --- | --- |
| 文件大小 | 1 byte 到 20 MB |
| 存储位置 | 系统临时目录 `open-codex-web-inputs` |

成功响应：

```json
{
  "type": "local_image",
  "path": "/tmp/open-codex-web-inputs/..."
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/components/AppleTaskComposer.tsx` | 上传拖入/选择的图片 |
| `frontend/src/components/TaskInput.tsx` | 旧版输入组件上传图片 |

### 4.2 发起 Codex 运行流

```http
POST /api/run
Accept: text/event-stream
```

请求体类型：

```ts
interface RunRequestBody {
  prompt?: string | null
  input?: unknown
  sessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  enabledSkills?: string[]
  versionId?: string | null
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
}
```

最小文本请求：

```json
{
  "prompt": "检查当前工作区进度",
  "sessionId": "session-1",
  "threadId": null,
  "turnId": "turn-1",
  "enabledSkills": [],
  "workspaceDir": "/data/lbk/codex_web/FreeCAD_data/v1_data",
  "workspaceId": "workspace-1",
  "versionId": "v1"
}
```

带图片输入请求：

```json
{
  "input": [
    { "type": "text", "text": "参考这张图调整结构" },
    { "type": "local_image", "path": "/tmp/open-codex-web-inputs/xxx.png" }
  ],
  "sessionId": "session-1",
  "threadId": "thread_xxx",
  "turnId": "turn-2",
  "enabledSkills": ["freecad"],
  "workspaceId": "workspace-1",
  "versionId": "v1"
}
```

校验规则：

| 条件 | 失败状态 |
| --- | --- |
| 没有 `prompt`、`input`，且没有可注入 skill | `400` |
| 缺少 `sessionId` | `400` |
| 缺少 `turnId` | `400` |
| `enabledSkills` 中存在未知技能 | `400` |
| 工作区上下文冲突 | `409` |

响应为 Server-Sent Events：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

每条事件格式：

```text
data: {"type":"thread.started","thread_id":"thread_xxx"}

data: {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"完成"}}
```

前端事件类型镜像 `frontend/src/types.ts`：

```ts
type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: Usage }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: ThreadItem }
  | { type: "item.updated"; item: ThreadItem }
  | { type: "item.completed"; item: ThreadItem }
  | { type: "thread_error"; error: { message: string } }
  | { type: "error"; message: string }
```

特殊事件：

| 事件 | 说明 |
| --- | --- |
| `item.completed` + `item.type = "ask_user"` | 后端从 agent 消息中提取用户提问协议后生成 |
| `turn.completed` | 前端收到后认为本轮逻辑结束 |
| `turn.failed` | 前端收到后认为本轮失败结束 |
| SSE 注释 `: ping` | 后端每 15 秒发送心跳 |

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/hooks/useTaskStream.ts` | 发起 `/run` 并解析 SSE |
| `frontend/src/hooks/useWorkspaceAppState.ts` | 管理运行状态、会话事件落盘 |

## 5. 图片与静态产物接口

### 5.1 读取本地图片

```http
GET /api/image?path=/absolute/path/to/file.png
```

支持扩展名：

| 后缀 | Content-Type |
| --- | --- |
| `.png` | `image/png` |
| `.jpg` / `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` |

成功响应为图片二进制，缓存 1 小时：

```http
Cache-Control: public, max-age=3600
```

失败：

| 场景 | 状态码 |
| --- | --- |
| 缺少 `path` | `400` |
| 不支持的文件类型 | `400` |
| 文件不存在 | `404` |

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/components/outputMarkdown.tsx` | 把本地图片 path 转成 `/api/image` |
| `frontend/src/components/bomData.ts` | BOM 图片路径转换 |
| `backend/src/workspaces/stageLogs.routes.ts` | 报告 markdown 图片链接改写 |

## 6. 工作区接口

### 6.1 获取工作区列表

```http
GET /api/workspace/workspaces
```

成功响应来自后端 `listWorkspaces()`，通常包含当前可选工作区与活动工作区信息。

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/workspace/workspaceVersion.ts` | `fetchWorkspaces()` |
| `frontend/src/pages/WorkspaceSessionPage.tsx` | 刷新左侧工作区/版本上下文 |

### 6.2 切换工作区

```http
POST /api/workspace/workspace
```

请求体：

```json
{
  "name": "v9_data"
}
```

成功响应来自后端 `setWorkspace()`。

失败：

| 场景 | 状态码 |
| --- | --- |
| 工作区名非法或切换失败 | `400` |

### 6.3 获取几何组件信息

```http
GET /api/workspace/component-info?workspaceId=...&versionId=...&workspaceDir=...
```

后端读取：

```text
component_info/geom_component_info.json
```

成功响应：

```json
{
  "...": "原 JSON 内容",
  "source_path": "/data/.../component_info/geom_component_info.json",
  "source_version": "/data/...:mtime:size"
}
```

失败：

| 场景 | 状态码 |
| --- | --- |
| 文件不存在 | `404` |
| 工作区定位失败 | `400/404/409`，取决于定位错误 |

### 6.4 获取 BOM 信息

```http
GET /api/workspace/bom?workspaceId=...&versionId=...&workspaceDir=...
```

后端按顺序读取：

```text
00_inputs/bom_component_info.json
00_inputs/real_bom.json
```

成功响应：

```json
{
  "...": "原 BOM JSON 内容",
  "source_path": "/data/.../00_inputs/bom_component_info.json",
  "source_version": "/data/...:mtime:size"
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/hooks/useBomInfo.ts` | 工作区页面定时刷新 BOM |
| `frontend/src/pages/ModelViewerPage.tsx` | 3D viewer 读取 BOM |

### 6.5 获取工作区进度

```http
GET /api/workspace/progress?workspaceId=...&versionId=...&workspaceDir=...&sessionId=...
```

后端优先读取：

```text
logs/progress.json
```

成功且存在：

```json
{
  "exists": true,
  "data": {},
  "source_path": "/data/.../logs/progress.json",
  "source_version": "/data/...:mtime:size",
  "updated_at": "2026-05-26T00:00:00.000Z"
}
```

不存在：

```json
{
  "exists": false,
  "data": null,
  "source_path": "/data/.../logs/progress.json",
  "source_version": null
}
```

如果 `progress.json` 暂时不是合法 JSON：

```json
{
  "exists": false,
  "data": null,
  "error": "progress json is not valid yet",
  "source_path": "/data/.../logs/progress.json",
  "source_version": "/data/...:mtime:size",
  "updated_at": "2026-05-26T00:00:00.000Z"
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/WorkspaceSessionPage.tsx` | 轮询进度面板 |

### 6.6 获取温度场点云

```http
GET /api/workspace/temperature-field?workspaceId=...&versionId=...&workspaceDir=...
```

后端读取 COMSOL 数据：

```text
02_sim/simulation/data1.txt
```

成功响应：

```json
{
  "schema_version": "1.0",
  "format": "threejs_temperature_point_cloud",
  "source": {
    "comsol_data": "/data/.../02_sim/simulation/data1.txt",
    "temperature_array": "T"
  },
  "units": {
    "position": "m",
    "temperature": "K"
  },
  "point_count": 100,
  "bounds": {
    "min": [0, 0, 0],
    "max": [1, 1, 1]
  },
  "temperature_range_K": {
    "min": 280,
    "max": 320
  },
  "attributes": {
    "position": [0, 0, 0],
    "temperature_K": [300],
    "color_rgb": [0, 1, 0]
  },
  "threejs_hint": {
    "geometry": "THREE.BufferGeometry",
    "position_attribute": "position",
    "color_attribute": "color_rgb",
    "temperature_attribute": "temperature_K",
    "material": "THREE.PointsMaterial({ vertexColors: true })"
  }
}
```

失败时通常返回 `404`：

```json
{
  "error": "temperature field not found"
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/ModelViewerPage.tsx` | 3D 温度场可视化 |

## 7. 工作区模型接口

### 7.1 查询模型元信息

```http
GET /api/workspace/model?sessionId=...&runId=...&variant=original&workspaceId=...&versionId=...&workspaceDir=...
```

query 参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `sessionId` | 否 | 用 session 查找最新模型 |
| `runId` | 否 | 用 run 查找模型 |
| `variant` | 否 | `original` 或 `replaced`，默认由后端归一化 |
| `glbPath` | 否 | 指定 GLB 路径 |
| `workspaceId` | 否 | 工作区 ID |
| `versionId` | 否 | 版本 ID |
| `workspaceDir` | 否 | 工作区目录 |

成功响应是 `resolveModel()` 返回的模型信息，并额外带 `modelUrl`：

```json
{
  "sessionId": "session-1",
  "runId": "run-1",
  "glbPath": "/data/.../geometry_after.glb",
  "version": "source-version",
  "updatedAt": "2026-05-26T00:00:00.000Z",
  "documentName": "geometry_after.glb",
  "modelUrl": "/api/workspace/model/file?sessionId=session-1&variant=original&v=..."
}
```

失败：

```json
{
  "error": "model not found"
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/viewer3d/modelSource.ts` | 3D viewer 查询模型 |
| `frontend/src/components/SessionModelPreview.tsx` | 会话列表/详情模型预览 |

### 7.2 读取 GLB 模型文件

```http
GET /api/workspace/model/file?sessionId=...&variant=original&workspaceDir=...
```

成功响应：

```http
Content-Type: model/gltf-binary
Cache-Control: no-cache
```

失败：

| 场景 | 状态码 |
| --- | --- |
| 模型未找到 | `404` |
| GLB 文件不存在 | `404` |
| 工作区定位失败 | 对应定位错误状态码 |

## 8. 日志接口

### 8.1 获取阶段日志

```http
GET /api/logs/stages?workspaceId=...&versionId=...&workspaceDir=...
```

后端读取工作区 `logs` 目录下最多 100 个 `*_stage_result.json` 文件，最多返回 300 条记录，并额外尝试加入：

```text
reports/report.md
```

响应：

```json
[
  {
    "id": "logs/layout_stage_result.json:0",
    "source": "logs/layout_stage_result.json",
    "stage_name": "布局生成",
    "status": "completed",
    "time": "2026-05-26T00:00:00.000Z",
    "detail": "完成",
    "fields": {
      "n_parts": "12",
      "placement_rate": "0.95"
    },
    "raw": {}
  }
]
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/WorkspaceSessionPage.tsx` | 阶段日志面板 |

### 8.2 获取对话日志

```http
GET /api/logs/conversation?workspaceId=...&versionId=...&workspaceDir=...
```

后端读取：

```text
logs/conversation-history.json
```

响应：

```json
[
  {
    "id": "conversation:session-1",
    "title": "历史对话",
    "detail": "3 turns",
    "status": "completed",
    "time": "2026-05-26T00:00:00.000Z",
    "source": "logs/conversation-history.json",
    "raw": {}
  }
]
```

文件不存在或 JSON 无效时返回空数组。

## 9. Manifest 接口

Manifest 类型对应 `backend/src/manifests/schema.ts`：

```ts
interface WorkspaceManifest {
  schemaVersion: "1.0"
  workspaceId: string
  sessionId: string
  rootDir: string
  activeVersionId: string | null
  versions: VersionRecord[]
  artifacts: ArtifactRecord[]
  checkpoints: CheckpointRecord[]
  runs: RunRecord[]
  scores: ScoreRecord[]
  createdAt: string
  updatedAt: string
}
```

### 9.1 读取会话工作区 Manifest

```http
GET /api/workspaces/:sessionId/manifest?initialize=1&workspaceDir=...&sourceWorkspaceDir=...
```

参数：

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `sessionId` | path | 会话 ID |
| `initialize` | query | `1` 或 `true` 时，不存在则创建 |
| `workspaceDir` | query | 工作区目录 |
| `sourceWorkspaceDir` | query | 初始化源目录 |

响应：

```json
{
  "schemaVersion": "1.0",
  "workspaceId": "workspace-1",
  "sessionId": "session-1",
  "rootDir": "/data/...",
  "activeVersionId": "v1",
  "versions": [],
  "artifacts": [],
  "checkpoints": [],
  "runs": [],
  "scores": [],
  "createdAt": "2026-05-26T00:00:00.000Z",
  "updatedAt": "2026-05-26T00:00:00.000Z"
}
```

### 9.2 读取当前/兼容 Manifest

```http
GET /api/workspace-manifest?initialize=1&workspaceKey=...&sessionId=...&workspaceDir=...&sourceWorkspaceDir=...
```

这是前端主要使用的兼容入口。当存在 `workspaceId` 时，前端优先使用下一节的 workspace-index 入口；否则使用本接口。

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/workspace/workspaceVersion.ts` | `fetchWorkspaceManifest()` |

### 9.3 按 workspaceId 读取 Manifest

```http
GET /api/workspace-index/:workspaceId/manifest?initialize=1&workspaceDir=...&sourceWorkspaceDir=...
```

按 `workspaceId` 定位 manifest。前端在有 `workspaceId` 时优先调用此接口。

## 10. Version 接口

### 10.1 从版本创建分支

```http
POST /api/versions/:versionId/branch
```

请求体：

```json
{
  "label": "尝试新的散热布局",
  "workspaceId": "workspace-1",
  "workspaceKey": "workspace-key",
  "workspaceDir": "/data/..."
}
```

要求至少提供 `workspaceId`、`workspaceKey`、`sessionId`、`workspaceDir` 之一。

成功响应：

```json
{
  "manifest": {}
}
```

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/workspace/workspaceVersion.ts` | `branchWorkspaceVersion()` |

### 10.2 切换活动版本

```http
POST /api/versions/:versionId/checkout
```

请求体：

```json
{
  "workspaceId": "workspace-1",
  "workspaceKey": "workspace-key",
  "workspaceDir": "/data/..."
}
```

成功响应为更新后的 manifest。

前端调用位置：

| 文件 | 用途 |
| --- | --- |
| `frontend/src/pages/workspace/workspaceVersion.ts` | `checkoutWorkspaceVersion()` |

### 10.3 提交版本

```http
POST /api/versions/:versionId/commit
```

请求体透传给后端 `commitVersion(versionId, body)`，常见字段可包含备注、产物、状态上下文等。

成功响应为更新后的版本/manifest 相关结果。

### 10.4 标记版本失败

```http
POST /api/versions/:versionId/fail
```

请求体透传给后端 `failVersion(versionId, body)`。

### 10.5 比较两个版本

```http
GET /api/versions/:a/diff/:b?workspaceId=workspace-1
```

要求：

| 字段 | 说明 |
| --- | --- |
| `a` | 版本 A |
| `b` | 版本 B |
| `workspaceId` | 必填 |

成功响应来自 `diffVersions(a, b, workspaceId)`。

## 11. Run Manifest 接口

这些接口管理 manifest 中的 `runs` 记录，不等同于 `/api/run` 的 Codex SSE 执行入口；`/api/run` 在工作区上下文存在时也会自动创建/更新 run 记录。

Run 类型：

```ts
interface RunRecord {
  id: string
  workspaceId: string
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled"
  createdAt: string
  updatedAt: string
  kind?: string
  sessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  versionId?: string | null
  skillNames?: string[]
}
```

### 11.1 创建 Run 记录

```http
POST /api/runs
```

请求体示例：

```json
{
  "workspaceId": "workspace-1",
  "versionId": "v1",
  "sessionId": "session-1",
  "turnId": "turn-1",
  "kind": "agent",
  "status": "running",
  "skillNames": ["freecad"]
}
```

成功响应：

```json
{
  "run": {}
}
```

### 11.2 读取 Run 记录

```http
GET /api/runs/:runId?workspaceId=workspace-1
```

`workspaceId` 必填。

### 11.3 更新 Run 记录

```http
PATCH /api/runs/:runId
```

请求体为要合并的字段：

```json
{
  "status": "completed",
  "threadId": "thread_xxx"
}
```

### 11.4 取消 Run

```http
POST /api/runs/:runId/cancel
```

请求体透传给 `setRunStatus(runId, body, "cancelled")`，常用于传 `workspaceId`。

### 11.5 重试 Run

```http
POST /api/runs/:runId/retry
```

请求体透传给 `retryRun(runId, body)`。

## 12. Artifact / Checkpoint / Score 注册接口

### 12.1 注册单个 Artifact

```http
POST /api/artifacts/register
```

请求体示例：

```json
{
  "workspaceId": "workspace-1",
  "versionId": "v1",
  "kind": "glb",
  "path": "/data/.../geometry_after.glb"
}
```

成功响应来自 `registerArtifact(body)`。

### 12.2 注册已有 Artifacts

```http
POST /api/versions/:versionId/artifacts/register-existing
```

请求体示例：

```json
{
  "workspaceId": "workspace-1",
  "paths": [
    "/data/.../geometry_after.glb",
    "/data/.../report.md"
  ]
}
```

成功响应来自 `registerExistingArtifacts(versionId, body)`。

### 12.3 注册 Checkpoint

```http
POST /api/checkpoints/register
```

请求体示例：

```json
{
  "workspaceId": "workspace-1",
  "versionId": "v1",
  "kind": "layout",
  "runId": "run-1",
  "artifactIds": ["artifact-1"],
  "status": "completed"
}
```

### 12.4 注册 Score

```http
POST /api/scores/register
```

请求体示例：

```json
{
  "workspaceId": "workspace-1",
  "versionId": "v1",
  "runId": "run-1",
  "metric": "temperature_max_K",
  "value": 315.2
}
```

## 13. 前端接口调用索引

| 前端文件 | 主要接口 |
| --- | --- |
| `frontend/src/app/apiBase.ts` | 定义默认 `/api` 与路径拼接 |
| `frontend/src/app/sessionUtils.ts` | `GET /sessions` |
| `frontend/src/hooks/useTaskStream.ts` | `POST /run` SSE |
| `frontend/src/hooks/useWorkspaceAppState.ts` | 会话读写、删除、运行调度 |
| `frontend/src/hooks/useBomInfo.ts` | `GET /workspace/bom` |
| `frontend/src/components/AppleTaskComposer.tsx` | `POST /run/input-files` |
| `frontend/src/components/TaskInput.tsx` | `GET /skills`、`POST /run/input-files` |
| `frontend/src/components/SessionModelPreview.tsx` | `GET /workspace/model`、`modelUrl` |
| `frontend/src/components/outputMarkdown.tsx` | `GET /image` |
| `frontend/src/pages/WorkspaceSessionPage.tsx` | progress、logs、manifest、workspace、version |
| `frontend/src/pages/workspace/workspaceVersion.ts` | workspaces、manifest、checkout、branch、switch |
| `frontend/src/pages/ModelViewerPage.tsx` | BOM、temperature-field |
| `frontend/src/pages/viewer3d/modelSource.ts` | model lookup |

## 14. 后端路由源码索引

| 后端文件 | 路由 |
| --- | --- |
| `backend/src/system/health.routes.ts` | `/api/health` |
| `backend/src/system/skills.routes.ts` | `/api/skills` |
| `backend/src/sessions/session.routes.ts` | `/api/sessions*` |
| `backend/src/codex-run/inputFiles.routes.ts` | `/api/run/input-files` |
| `backend/src/codex-run/run.routes.ts` | `/api/run` |
| `backend/src/artifacts/image.routes.ts` | `/api/image` |
| `backend/src/workspaces/workspace.routes.ts` | `/api/workspace/workspaces`、`/api/workspace/workspace` |
| `backend/src/workspaces/workspaceData.routes.ts` | `/api/workspace/component-info`、`/api/workspace/bom`、`/api/workspace/progress`、`/api/workspace/temperature-field` |
| `backend/src/workspaces/model.routes.ts` | `/api/workspace/model`、`/api/workspace/model/file` |
| `backend/src/workspaces/stageLogs.routes.ts` | `/api/logs/stages`、`/api/logs/conversation` |
| `backend/src/manifests/workspaceManifest.routes.ts` | `/api/workspaces/:sessionId/manifest`、`/api/workspace-manifest`、`/api/workspace-index/:workspaceId/manifest` |
| `backend/src/manifests/version.routes.ts` | `/api/versions/*` |
| `backend/src/manifests/run.routes.ts` | `/api/runs*` |
| `backend/src/manifests/registration.routes.ts` | artifact/checkpoint/score 注册 |

## 15. 调试示例

健康检查：

```bash
curl -sS http://localhost:3003/api/health
```

读取会话：

```bash
curl -sS http://localhost:3003/api/sessions
```

读取 BOM：

```bash
curl -sS "http://localhost:3003/api/workspace/bom?workspaceId=workspace-1&versionId=v1"
```

发起 Codex SSE 运行：

```bash
curl -N -sS http://localhost:3003/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "查看当前工作区状态",
    "sessionId": "debug-session",
    "threadId": null,
    "turnId": "debug-turn-1",
    "enabledSkills": []
  }'
```

GNC 工作区同一接口：

```bash
curl -N -sS http://localhost:3003/api/gnc/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "检查 GNC 工作区状态",
    "sessionId": "debug-gnc-session",
    "threadId": null,
    "turnId": "debug-gnc-turn-1",
    "enabledSkills": []
  }'
```

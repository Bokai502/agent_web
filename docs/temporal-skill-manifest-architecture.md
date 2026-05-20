# Skill + Manifest 架构设计

本文档整理关于“多函数协作、多轮迭代、版本切换”的设计讨论，目标是在现有 `open_codex_web` 基础上，引入 Skill 主导的执行流程、版本化文件管理和智能候选方案探索能力。

本文档分为两个版本：

- V1：`design-iteration` skill 作为 LLM 控制层，`freecad` / `simulation-skill` 执行领域任务，Manifest / SQLite 管理文件版本、run、artifact。
- V2：在 V1 基础上加入目标式规划、候选版本并行探索、Reviewer、Scorer 和确定性评分。

## 当前现状

当前系统已经具备：

- `sessionId` 多轮对话记录。
- `sessions.json` 持久化聊天 session、turns、events。
- Codex SDK thread resume 能力。
- FreeCAD 相关 skill：`freecad`。
- Thermal simulation 相关 skill：`simulation-skill`。
- FreeCAD / simulation 局部产物和进度文件，例如：
  - `01_cad/geometry_after.step`
  - `01_cad/geometry_after.glb`
  - `01_cad/cad_agent_output.json`
  - `02_sim/run_manifest.json`
  - `logs/progress_percentages.json`
  - `logs/pipeline.log`

当前还缺少：

- 统一的版本 manifest。
- `session -> run -> version -> artifact` 的事实模型。
- 文件版本管理层。
- run 状态记录。
- 版本 checkout、branch、retry、diff API。
- 面向 UI 的稳定 run/version 状态查询接口。

核心问题是：当前 `sessionId` 只记录“说过什么”，不能可靠表达“工程状态如何演化”。

## V1 目标架构

V1 采用 Skill 主导执行的四层结构：

```text
design-iteration skill 控制层
  |
  v
Skill 执行层
  |
  v
文件版本管理层
  |
  v
Manifest 状态层
```

职责划分：

- `design-iteration` skill 控制层：理解用户意图、规划整体流程、决定 branch / checkout / retry / compare。
- Skill 执行层：由 `freecad` 和 `simulation-skill` 直接执行 CAD、仿真、分析等领域任务。
- 文件版本管理层：准备 version workspace、复制/分支文件、注册 artifact、维护 active pointer。
- Manifest 状态层：记录 workspace、version、run、artifact、score，是工程状态事实来源。

整体结构：

```text
Frontend
  |
  v
Fastify Backend
  |
  +--> design-iteration skill
  |       - 理解用户意图
  |       - 规划整体流程
  |       - 调用 freecad / simulation-skill
  |       - 决定版本分支、切换、重跑和比较
  |       - 解释 CAD / simulation / analysis 结果
  |
  +--> Skill Execution
  |       - freecad skill
  |       - simulation-skill
  |
  +--> File Version API
  |       - create draft version
  |       - branch version
  |       - checkout version
  |       - register artifact
  |
  +--> Manifest API / Store
          - 管理 session / workspace / run / version / artifact / score
```

## V1 Skill 的角色更新

现有 `freecad` 和 `simulation-skill` 作为执行层，不再要求被翻译成规范化 Activity Adapter。

这意味着：

- `design-iteration` skill 负责规划整体流程。
- `freecad` skill 负责 CAD build / move / validate 的真实执行。
- `simulation-skill` 负责 doctor / simulation / postprocess / analysis 的真实执行。
- 文件版本管理层负责在每次 skill 执行前提供正确的 `workspaceDir`，并在执行后注册产物。

### Skill 分类

#### 领域执行 Skill

已有：

- `freecad`
- `simulation-skill`

它们负责定义如何正确执行领域操作，包括：

- 使用哪个 CLI 入口。
- 如何解析 workspace。
- 哪些输入文件是必需的。
- 输出文件在哪里。
- 哪些进度文件要检查。
- 什么状态算成功。
- 失败后应该查看哪些日志。

#### 控制 Skill

建议新增：

- `design-iteration`

它负责把用户意图转换成版本化 skill 执行流程，例如：

- 读取当前 manifest。
- 判断 active version。
- 决定 create / modify / simulate / analyze / retry / branch。
- 调用文件版本 API 创建 draft version。
- 调用 `freecad` 和 `simulation-skill` 执行领域任务。
- 查询 run 状态。
- 比较版本结果。
- 向用户解释结果。

编排 skill 可以调用领域执行 skill，但不应该绕过文件版本管理层直接改 active version 或 artifact registry。

## V1 Skill 执行层

V1 不要求写 `FreeCADActivityAdapter` 或 `SimulationActivityAdapter`。执行层直接使用已有 skill。

```text
design-iteration skill
  |
  +--> file-version: create draft version workspace
  |
  +--> freecad skill
  |       - 执行 cad build / layout safe-move / cad validate
  |
  +--> simulation-skill
  |       - 执行 doctor / simulation / analysis
  |
  +--> file-version: register artifacts
  |
  +--> file-version: commit or fail version
```

### FreeCAD Skill 执行

`freecad` skill 继续遵守它自己的核心规则：

- 先运行：

```bash
python -m freecad_cli_tools.cli.main config show
```

- 使用 `/data/lbk/codex_web/config.json` 中的 `freecad.workspaceDir`。
- 创建 CAD 时执行：

```bash
python -m freecad_cli_tools.cli.main cad build
python -m freecad_cli_tools.cli.main cad validate
```

- 修改 CAD 时执行：

```bash
python -m freecad_cli_tools.cli.main layout safe-move
python -m freecad_cli_tools.cli.main cad validate
```

- 标准输出包括：
  - `01_cad/geometry_after.step`
  - `01_cad/geometry_after.glb`
  - `01_cad/simulation_input.json`
  - `01_cad/cad_agent_output.json`
- 检查 `logs/progress_percentages.json`。
- 如果 STEP 存在但 GLB 缺失，应记录为部分成功或失败，不能误报完整成功。

### Simulation Skill 执行

`simulation-skill` 继续遵守它自己的核心规则：

- 使用第一入口：

```bash
/data/conda/bin/python /data/lbk/codex_web/freecad_skills/sim_skills/sim_cli_tools/sim_run.py
```

- 先运行 doctor：

```bash
/data/conda/bin/python /data/lbk/codex_web/freecad_skills/sim_skills/sim_cli_tools/sim_run.py \
  --json doctor \
  --workspace-dir <workspace>
```

- 真实仿真使用 `comsol_local`。
- COMSOL run 使用私有 mphserver，不复用既有 mphserver。
- 成功后检查：
  - `02_sim/run_manifest.json`
  - `02_sim/simulation/status.json`
  - `02_sim/simulation/simulation_manifest.json`
  - `02_sim/simulation/data1.txt`
  - `02_sim/simulation/native.vtu`
  - `02_sim/postprocess/render_summary.json`
  - `02_sim/case_build/component_index.json`
  - `02_sim/analysis/metrics_summary.json`
  - `logs/progress_percentages.json`

## V1 文件版本管理层

文件版本管理层是 V1 的核心新增能力。它是 service/API 层，封装所有 version 文件操作和 manifest 写入，负责保证文件系统与 Manifest 记录一致。

它不替代 skill 执行，也不替代聊天 session。它负责把文件系统里的 CAD/仿真产物组织成可追踪、可切换、可比较的版本。

文件版本管理层负责：

- `createWorkspace(sessionId)`：为 session 创建版本化 workspace root。
- `createDraftVersion(baseVersionId)`：从 base version 准备一个 draft version workspace。
- `branchVersion(baseVersionId)`：从已有 version 分支出新 version。
- `checkoutVersion(versionId)`：切换 active version pointer。
- `resolveWorkspaceDir(versionId)`：为 skill 提供当前 version workspace path。
- `createRun(...)` / `markRunStatus(...)`：创建 run 并更新 run 状态。
- `registerArtifact(...)`：注册 artifact 路径、类型和 hash。
- `registerScore(...)`：注册 scoring summary 和评分结果。
- `commitVersion(versionId)`：将 draft version 标记为可用或 active。
- `failVersion(versionId, error)`：保留失败 version 并记录错误。
- `diffVersions(a, b)`：比较两个 version 的 artifact 和 metrics。

文件版本管理层不负责：

- 解释用户意图。
- 决定移动哪个组件。
- 执行 FreeCAD / COMSOL。
- 替代 `freecad` 或 `simulation-skill`。
- 直接承载聊天历史。

重要约束：

- Skill 不直接编辑 manifest 文件。
- Skill 通过文件版本管理 API 间接更新 Manifest。
- 文件版本管理 API 是唯一允许修改 active version、run、artifact、score 事实记录的入口。

## V1 Manifest 的职责

Manifest 是数据模型和持久化层，是工程状态的事实来源。它不执行文件操作，也不运行 skill。

它记录：

- 当前 active version。
- version parent/branch 关系。
- version 状态：`draft`、`active`、`archived`、`failed`。
- 每个 run 的状态。
- 每个 run 由哪些 skill 执行。
- 每个 artifact 的路径、类型、hash。
- 每个 score 的路径、分数和 pass/fail 结果。
- candidate set 包含哪些 version。
- 失败原因和完成时间。

Manifest 不负责：

- 复制 version 文件。
- checkout 文件目录。
- 计算 artifact hash。
- 执行 CAD / simulation。
- 解释用户目标。

文件版本管理层读取和写入 Manifest；其他层只通过 API 查询或间接更新 Manifest。

建议数据模型：

```ts
type WorkspaceManifest = {
  schemaVersion: "1.0"
  workspaceId: string
  sessionId: string
  activeVersionId: string | null
  versions: VersionRecord[]
  runs: RunRecord[]
  artifacts: ArtifactRecord[]
  checkpoints: CheckpointRecord[]
}

type VersionRecord = {
  id: string
  parentVersionId: string | null
  label?: string
  status: "draft" | "active" | "archived" | "failed"
  createdByRunId: string
  createdAt: string
  artifactRefs: Record<string, string>
}

type RunRecord = {
  id: string
  sessionId: string
  baseVersionId: string | null
  outputVersionId: string | null
  kind: "cad" | "simulation" | "analysis" | "suggestion" | "full_pipeline" | "scoring" | "custom"
  status: "queued" | "running" | "waiting_for_user" | "completed" | "failed" | "cancelled"
  currentStep?: string
  skillNames: string[]
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  error?: string
  startedAt: string
  finishedAt?: string
}

type ArtifactRecord = {
  id: string
  runId: string
  versionId: string
  type: "step" | "glb" | "json" | "image" | "log" | "report"
  path: string
  sha256?: string
  createdAt: string
}

type CheckpointRecord = {
  id: string
  versionId: string
  runId: string
  step: string
  status: "created" | "completed" | "failed"
  workspaceDir: string
  artifactRefs: Record<string, string>
  stateRefs: Record<string, string>
  createdAt: string
}
```

## V1 Checkpoint 设计

当前 workspace 中已经存在一些类似 checkpoint 的文件，但它们不是统一的版本级 checkpoint。

现有文件的定位：

- `02_sim/run_state.json`：最像 run 当前状态快照。
- `02_sim/run_manifest.json`：一次 simulation / pipeline run 的阶段、输入、输出、状态总索引。
- `logs/*_stage_result.json`：每个 stage 的结果快照，例如 `simulation_run_stage_result.json`、`analysis_stage_result.json`。
- `logs/progress_percentages.json`：进度快照，适合 UI 展示当前阶段和百分比。
- `02_sim/simulation/status.json`：simulation 内部状态。
- `02_sim/simulation/simulation_manifest.json`：simulation 产物索引。

这些文件可以复用为低层 checkpoint，但它们主要描述某次工具运行的状态，不描述上层版本事实，例如：

- 这个 version 从哪个 parent 来。
- 当前 active version 是谁。
- 这个 version 包含哪些 artifact。
- 这个 version 是否可 checkout。
- 这个 version 是否可 branch。
- 某个 run 是否可以从某一步继续或重试。

因此 V1 需要一个上层版本级 checkpoint，建议由 Manifest / SQLite 记录 `CheckpointRecord`，而不是只依赖单个文件名为 `checkpoint.json` 的文件。

推荐分层：

```text
run_state / progress
  = 执行中的进度 checkpoint

run_manifest / stage_result
  = 工具运行结果 checkpoint

WorkspaceManifest.checkpoints
  = 版本级 checkpoint
```

版本级 checkpoint 应在关键边界创建：

- draft version 创建后。
- FreeCAD build / move / validate 完成后。
- simulation doctor 完成后。
- simulation run 完成后。
- analysis 完成后。
- scoring 完成后。
- version commit / fail 时。

示例：

```json
{
  "id": "ckpt_v0004_simulation_completed",
  "versionId": "v0004",
  "runId": "run_20260520_001",
  "step": "simulation",
  "status": "completed",
  "workspaceDir": "FreeCAD_data/workspaces/session_x/versions/v0004",
  "artifactRefs": {
    "runManifest": "02_sim/run_manifest.json",
    "simulationStatus": "02_sim/simulation/status.json",
    "nativeVtu": "02_sim/simulation/native.vtu",
    "metricsSummary": "02_sim/analysis/metrics_summary.json"
  },
  "stateRefs": {
    "runState": "02_sim/run_state.json",
    "progress": "logs/progress_percentages.json",
    "simulationStageResult": "logs/simulation_run_stage_result.json"
  },
  "createdAt": "2026-05-20T00:00:00.000Z"
}
```

Checkpoint 使用规则：

- Skill 不直接手写 checkpoint 记录。
- Skill 完成一个阶段后，通过文件版本管理 API 注册 checkpoint。
- checkpoint 只保存路径、状态和摘要，不复制大文件内容。
- 恢复、retry、diff、checkout 都优先查询 Manifest / SQLite 中的 checkpoint 记录。
- 低层 `run_state.json`、`progress_percentages.json`、`stage_result.json` 仍保留为 evidence files。

## V1 推荐版本化目录

为了避免让现有 FreeCAD/simulation CLI 直接理解 version 概念，建议每个 version 使用一个完整 workspace。

```text
FreeCAD_data/
  workspaces/
    <sessionId>/
      workspace_manifest.json
      versions/
        v0001/
          00_inputs/
          01_cad/
          02_sim/
          logs/
        v0002/
          00_inputs/
          01_cad/
          02_sim/
          logs/
      runs/
        run_xxx/
          logs/
```

每次迭代：

1. 从 base version 复制或准备一个新 draft version workspace。
2. Skill 在 draft version workspace 中运行。
3. 成功后将 draft version 标记为 active。
4. 失败后保留 draft version 和 logs，状态标记为 failed。

## V1 流程示例

典型 design iteration 流程：

```text
DesignIteration
  input:
    sessionId
    workspaceId
    runId
    baseVersionId
    operation
    parameters

  steps:
    createDraftVersion
    prepareInputs
    invoke freecad skill
    invoke simulation-skill
    collect metrics
    registerArtifacts
    optionally run deterministic scoring
    commitVersion
```

失败路径：

```text
on failure:
  markRunFailed
  markVersionFailed
  preserve logs/artifacts
  return error summary
```

等待用户：

```text
if approval required:
  markRunWaitingForUser
  ask user through existing ask-user flow
```

## V1 后端 API 建议

新增 API：

```text
GET  /api/workspaces/:sessionId/manifest
POST /api/runs
GET  /api/runs/:runId
POST /api/runs/:runId/cancel
POST /api/runs/:runId/retry
POST /api/versions/:versionId/checkout
POST /api/versions/:versionId/branch
GET  /api/versions/:a/diff/:b
POST /api/artifacts/register
POST /api/scores/register
```

前端只访问后端 API。Skill 执行时通过这些 API 获取和更新版本事实。

## V1 一次请求的链路

用户说：“基于当前设计，把 A 模块右移 10mm 并重新仿真。”

```text
1. Codex 使用 design-iteration skill。
2. Skill 调 GET /api/workspaces/:sessionId/manifest。
3. Skill 发现 activeVersionId = v0003。
4. Skill 调 POST /api/versions/v0003/branch 创建 draft version v0004。
5. Skill 调 POST /api/runs 创建 runId。
6. freecad skill 在 v0004 workspace 执行 layout safe-move + cad validate。
7. simulation-skill 在 v0004 workspace 执行 doctor + run。
8. Skill 或后端调用 POST /api/artifacts/register 注册产物。
9. 可选 scoring step 生成并注册 scoring_summary.json。
10. Skill 调 commit/checkout API 将 v0004 标记为 active。
11. 前端显示 run completed。
12. Codex 查询结果并向用户解释。
```

## V1 推荐库

### Manifest 存储

原型阶段可用 JSON 文件，但建议尽早使用 SQLite，因为会有并发写入、retry、checkout、branch、artifact 注册。

TypeScript 推荐：

```bash
npm install zod better-sqlite3 drizzle-orm
npm install -D drizzle-kit
```

用途：

- `zod`：API payload 和 manifest schema 校验。
- `better-sqlite3`：本地事务存储。
- `drizzle-orm`：类型化 schema 和查询。

如果后续多人并发或服务化部署，迁移到 Postgres：

```bash
npm install drizzle-orm pg zod
```

或：

```bash
npm install prisma @prisma/client zod
```

### 不建议

不建议长期只使用 `workspace_manifest.json` 承载所有状态。JSON 文件适合原型，但对并发、事务、retry 幂等、状态查询都不如 SQLite/Postgres。

### 可选 Temporal 增强

如果后续需要长任务可靠恢复或严格 cancel/signal/query，再引入 Temporal：

```bash
npm install @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity
```

但即使引入 Temporal，文件版本管理仍应由 Manifest / SQLite / 文件系统负责。

## V1 工程原则

- Session 只管聊天历史，不管工程版本事实。
- Manifest 是 version/run/artifact 的事实来源。
- Skill 是领域执行来源。
- `design-iteration` skill 负责流程规划和解释。
- `freecad` / `simulation-skill` 负责领域执行。
- 文件版本管理层负责 branch、checkout、artifact 注册和 run 状态。
- 每个 run/version/step 输出路径固定。
- checkout 不等于重跑，只是切换 active pointer。
- branch 必须记录 parentVersionId。
- failed version 和 failed run 也要保留，以便 debug 和 retry。
- Temporal 是可选增强项，不是 V1 的文件版本管理层。

## V1 建议落地顺序

1. 定义 manifest schema 和 store。
2. 新增 `/api/workspaces/:sessionId/manifest`。
3. 新增 `/api/versions/:versionId/branch` 和 checkout API。
4. 新增 `/api/runs` 和 run 状态更新 API。
5. 新增 `/api/artifacts/register`。
6. 新增 `design-iteration` skill，让它使用版本 API 后再调用 `freecad` / `simulation-skill`。
7. 让每个 version 使用完整 workspace 目录。
8. 前端增加 version 列表、active version、run 状态、checkout、branch、retry。
9. 后续增加 version diff、artifact preview、scoring summary。
10. 需要长任务可靠恢复时，再评估是否引入 Temporal。

## V2 智能设计目标

V1 解决“可靠地执行用户指定操作”。V2 的目标是进一步支持“用户提出目标，系统自动探索多个候选版本，并用确定性指标和评分推荐结果”。

V2 不改变 V1 的基础职责边界：

- `design-iteration` skill 负责目标理解、候选生成、调用执行 skill 和解释。
- `freecad` / `simulation-skill` 负责执行候选版本的领域任务。
- 文件版本管理层负责创建候选 version workspace、run、artifact、checkpoint、score 记录。
- Manifest / SQLite 负责记录候选集合、版本、run、artifact、checkpoint、score。
- 确定性 scorer 负责评分计算。
- `design-iteration` 内部 reviewer 规则负责检查候选方案和结论是否满足约束。

V2 的核心变化是把系统从命令式执行升级为目标式探索。

命令式执行示例：

```text
把 A 模块右移 10mm，然后重新仿真。
```

目标式探索示例：

```text
降低热点温度，同时尽量少改布局。
```

目标式探索要求系统自己决定：

- 是否需要移动组件。
- 移动哪些组件。
- 生成几个候选方案。
- 哪些候选需要 CAD rebuild。
- 哪些候选需要 simulation。
- 用什么指标评价。
- 是否需要继续迭代。

## V2 智能架构

```text
User Goal
  |
  v
design-iteration skill
  |
  +--> parse goal into ObjectiveSpec
  +--> read manifest
  +--> read latest checkpoints / metrics / diagnosis / scoring summary
  +--> retrieve similar past cases
  +--> generate candidate operations
  +--> review candidate operations
  |
  v
File Version API
  |
  +--> create candidate set
  +--> branch candidate versions
  +--> create runs
  |
  v
Candidate Skill Runs
  |
  +--> freecad skill
  +--> simulation-skill
  +--> deterministic scoring step
  |
  v
Metric Extractor + Deterministic Scorer
  |
  v
Version Ranking
  |
  v
design-iteration explanation / User Decision
```

V2 不建议把 goal parser、planner、reviewer 拆成多个顶层 skill。它们应作为 `design-iteration` skill 内部的协议和步骤，避免出现多个控制层互相竞争。

`design-iteration` skill 在 V2 中增加三组内部能力：

- Goal Parser：把用户目标转成 `ObjectiveSpec`。
- Planner：基于 manifest、checkpoint、历史经验生成候选操作。
- Reviewer：检查候选操作、约束、artifact 完整性和结论证据。

评分计算不应由 LLM 完成，而应由确定性 scorer 代码生成 `scoring_summary.json`。

## V2 目标解析

用户自然语言目标应被解析为结构化 `ObjectiveSpec`。

```ts
type ObjectiveSpec = {
  goal: "minimize_hotspot" | "reduce_gradient" | "keep_temperature_in_range" | "improve_clearance"
  constraints: Array<{
    metric: string
    op: "<=" | ">=" | "==" | "!="
    value: number | string
  }>
  weights: Record<string, number>
  candidateLimit: number
}
```

示例：

```json
{
  "goal": "keep_temperature_in_range",
  "constraints": [
    { "metric": "anomaly_count", "op": "==", "value": 0 },
    { "metric": "max_displacement_mm", "op": "<=", "value": 20 }
  ],
  "weights": {
    "thermal_score": 0.7,
    "layout_change_cost": -0.2,
    "simulation_confidence": 0.1
  },
  "candidateLimit": 3
}
```

LLM 可以生成 `ObjectiveSpec`，但后端应校验 schema，并使用确定性 scorer 排序。

## V2 候选版本并行探索

V2 不应一次只生成一个版本，而是可以从同一个 base version 分支出多个候选：

```text
v0003
├── v0004: A 右移 10mm
├── v0005: A 右移 15mm
├── v0006: B 左移 8mm
└── v0007: A 右移 10mm + B 左移 5mm
```

每个候选版本运行独立 skill run，并在关键边界注册 checkpoint：

```text
createDraftVersion
  -> register checkpoint: draft_created
  -> invoke freecad skill
  -> register checkpoint: cad_completed
  -> invoke simulation-skill
  -> register checkpoint: simulation_completed
  -> run deterministic scoring
  -> register checkpoint: scoring_completed
  -> commitCandidateVersion
```

如果后续候选并行运行和长任务恢复变复杂，可以把这些候选 skill run 再交给 Temporal 调度；但 V2 的评分、版本和 artifact 管理仍然由 Manifest / SQLite 负责。

所有候选完成后，系统按确定性排序规则推荐版本。

建议排序规则：

```text
1. pass=true 的版本优先于 pass=false。
2. pass 状态相同，score 高的版本优先。
3. score 接近时，layout_change_cost 低的版本优先。
4. 仍然接近时，simulation_confidence 高的版本优先。
```

## V2 并发版本与文件管理

V2 并发执行时，版本与文件仍然由文件版本管理层 + Manifest / SQLite 管理。不要让 skill 自己手动管理候选目录，也不要让 Temporal 管文件版本。

推荐模型：

```text
CandidateSet
  -> 多个 Candidate Version
  -> 每个 Version 一个独立 workspace
  -> 每个 Version 独立 run / artifact / checkpoint / score
  -> SQLite 事务维护状态一致性
```

关键原则：

```text
一个候选版本 = 一个独立 workspace 目录
```

示例目录：

```text
FreeCAD_data/
  workspaces/
    session_x/
      versions/
        v0003/              # base version，只读
        v0004_candidate_a/  # 候选 A
        v0005_candidate_b/  # 候选 B
        v0006_candidate_c/  # 候选 C
      runs/
        run_a/
        run_b/
        run_c/
      workspace_manifest.sqlite
```

每个 skill run 只允许写自己的 candidate version workspace：

```text
v0004_candidate_a/
  00_inputs/
  01_cad/
  02_sim/
  logs/

v0005_candidate_b/
  00_inputs/
  01_cad/
  02_sim/
  logs/
```

这样 `freecad` 和 `simulation-skill` 可以继续使用固定相对路径，例如：

- `01_cad/geometry_after.step`
- `02_sim/run_manifest.json`
- `02_sim/analysis/metrics_summary.json`
- `logs/progress_percentages.json`

因为这些文件位于不同 candidate workspace，不会互相覆盖。

并发候选运行时不要共享 active workspace，也不要让多个候选都写当前 `/data/lbk/codex_web/FreeCAD_data/v9_data` 这种单一路径。正确方式是：

```text
base version workspace 只读
candidate workspace 独立写
```

### activeVersionId 更新规则

候选运行期间不要频繁切换 `activeVersionId`。

推荐流程：

```text
activeVersionId = v0003
candidateSet.baseVersionId = v0003
v0004 / v0005 / v0006 都是 candidate
```

所有候选完成、排序并经过用户确认或自动策略确认后，再选择一个版本：

```text
POST /api/candidate-sets/:id/select
```

选择后才更新：

```text
activeVersionId = selectedVersionId
```

也就是说：

```text
候选运行不改变 activeVersionId
只有 select / checkout 时才改变 activeVersionId
```

### 文件复制策略

创建候选版本时可选三种策略：

1. 完整复制。

```bash
cp -a versions/v0003 versions/v0004_candidate_a
```

优点是最简单、隔离最好。缺点是大文件多时占空间。

2. Reflink / copy-on-write 优先。

```bash
cp -a --reflink=auto versions/v0003 versions/v0004_candidate_a
```

优点是快且省空间，底层支持时可以 copy-on-write。建议 V2 第一版采用这个策略，并在不支持 reflink 时 fallback 到普通复制。

3. DVC / object store。

当 STEP / GLB / VTU / MPH 等 artifact 规模明显变大时再考虑。

V2 第一版推荐：

```text
SQLite + 独立 candidate workspace + cp --reflink=auto fallback cp -a
```

### 并发状态与锁

并发下建议使用 SQLite 事务和唯一约束，而不是单个 JSON manifest 文件。

核心表：

```text
workspaces
versions
runs
artifacts
checkpoints
candidate_sets
scores
locks
```

建议唯一约束：

```text
versions.id unique
runs.id unique
artifacts(version_id, path) unique
checkpoints(version_id, step, run_id) unique
candidate_sets.id unique
```

锁粒度应尽量小：

- 创建 version 时锁 `workspaceId`。
- 写某个 candidate version 时锁 `versionId`。
- 修改 `activeVersionId` 时锁 `workspaceId`。
- 注册 artifact / checkpoint / score 时使用 SQLite transaction。

可选锁表：

```ts
type LockRecord = {
  resourceType: "workspace" | "version" | "candidate_set"
  resourceId: string
  ownerRunId: string
  expiresAt: string
}
```

第一版也可以先依赖 SQLite transaction + 目录名唯一性，等并发冲突真实出现后再加显式锁表。

### Skill Workspace 约束

`design-iteration` 为每个候选创建 version 后，必须给执行 skill 明确传入：

```text
workspaceDir = FreeCAD_data/workspaces/session_x/versions/v0004_candidate_a
```

并要求：

- 只使用这个 `workspaceDir`。
- 不写 base version workspace。
- 不写 active workspace。
- 不搜索其他 workspace。
- 完成后通过文件版本管理 API 注册 artifact、checkpoint 和 score。

## V2 Manifest 扩展

建议在 V1 manifest 基础上增加 candidate set 和 score 记录，并让候选版本复用 V1 的 `CheckpointRecord`。

```ts
type CandidateSetRecord = {
  id: string
  sessionId: string
  baseVersionId: string
  objective: ObjectiveSpec
  versionIds: string[]
  runIds: string[]
  checkpointIds: string[]
  scoreIds: string[]
  selectedVersionId?: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  createdAt: string
  finishedAt?: string
}

type ScoreRecord = {
  id: string
  versionId: string
  runId: string
  artifactId: string
  score: number
  pass: boolean
  grade: "passed" | "warning" | "failed"
  scoreScale: "0-100 higher_is_better"
  createdAt: string
}
```

`VersionRecord` 可增加：

```ts
type VersionRecord = {
  // V1 fields...
  candidateSetId?: string | null
  scoreId?: string | null
  checkpointIds?: string[]
  workspaceDir?: string
  status?: "draft" | "running" | "candidate_completed" | "active" | "archived" | "failed"
}
```

## V2 确定性评分设计

当前 simulation 输出已经有确定性指标，例如：

- `02_sim/analysis/metrics_summary.json`
- `02_sim/analysis/anomaly_candidates.json`
- `02_sim/analysis/diagnosis.json`

但这些文件目前是 deterministic metrics 和 deterministic diagnosis，不是统一评分。

建议新增：

```text
02_sim/analysis/scoring_summary.json
```

评分原则：

- 固定范围：`0-100`，越高越好。
- 分数可拆解为多个 penalty。
- 硬约束和软评分分开。
- LLM 不参与数值计算，只解释评分结果。
- 评分公式版本化，例如 `score_version: "thermal_contract_v1"`。

### 硬约束

硬约束决定 `pass`，不直接决定分数。

示例配置：

```json
{
  "allow_min_K": 250,
  "allow_max_K": 320,
  "max_anomaly_count": 0,
  "required_simulation_ok": true
}
```

硬失败条件：

```text
simulation ok != true
anomaly_count > max_anomaly_count
min_K < allow_min_K
max_K > allow_max_K
```

### 软评分公式

建议第一版 thermal score：

```text
score = 100
        - anomaly_penalty
        - range_penalty
        - spread_penalty
        - mean_penalty
```

各 penalty 都设上限，避免单个指标无限支配结果。

#### anomaly_penalty

按异常比例计算，而不是直接使用异常数量。

```text
sample_count = tensor_summary.sample_count
anomaly_ratio = anomaly_count / sample_count
anomaly_penalty = min(50, anomaly_ratio * 50)
```

#### range_penalty

衡量温度超出允许区间的程度。

```text
allowed_span_K = allow_max_K - allow_min_K
below_min_K = max(0, allow_min_K - min_K)
above_max_K = max(0, max_K - allow_max_K)
range_violation_K = below_min_K + above_max_K
range_penalty = min(30, range_violation_K / allowed_span_K * 30)
```

#### spread_penalty

衡量温度分布是否过于不均匀。

```text
spread_K = max_K - min_K
spread_penalty = min(10, spread_K / allowed_span_K * 10)
```

#### mean_penalty

衡量平均温度离目标中心的距离。

```text
target_K = (allow_min_K + allow_max_K) / 2
mean_deviation_K = abs(mean_K - target_K)
mean_penalty = min(10, mean_deviation_K / (allowed_span_K / 2) * 10)
```

### 当前 v9_data 示例

当前 `/data/lbk/codex_web/FreeCAD_data/v9_data/02_sim/analysis/metrics_summary.json` 中：

```json
{
  "component_count": 60,
  "anomaly_count": 743,
  "temperature_summary": {
    "min_K": 2.9999999816508605,
    "max_K": 4.281815702330134,
    "mean_K": 3.082415
  },
  "tensor_summary": {
    "sample_count": 743
  }
}
```

使用默认配置：

```text
allow_min_K = 250
allow_max_K = 320
allowed_span_K = 70
sample_count = 743
```

计算：

```text
anomaly_ratio = 743 / 743 = 1
anomaly_penalty = min(50, 1 * 50) = 50

below_min_K = 250 - 2.9999999816508605 = 247.00000001834914
above_max_K = 0
range_penalty = min(30, 247.00000001834914 / 70 * 30) = 30

spread_K = 4.281815702330134 - 2.9999999816508605 = 1.2818157206792737
spread_penalty = min(10, 1.2818157206792737 / 70 * 10) = 0.18311653152561054

target_K = 285
mean_deviation_K = abs(3.082415 - 285) = 281.917585
mean_penalty = min(10, 281.917585 / 35 * 10) = 10

score = 100 - 50 - 30 - 0.18311653152561054 - 10
      = 9.81688346847439
```

结果：

```json
{
  "score": 9.816883,
  "pass": false,
  "grade": "failed"
}
```

注意：当前 `observed_K` 大量约为 `3 K`，这明显低于 `[250 K, 320 K]` 的默认允许区间。`3 K` 接近深空或低温物理实验量级，通常不像真实电子设备工作温度。因此评分应同时暴露硬失败原因，避免把单位或数据源问题掩盖成普通低分。

## V2 scoring_summary.json 建议结构

```json
{
  "schema_version": "1.0",
  "score_version": "thermal_contract_v1",
  "ok": true,
  "pass": false,
  "score": 9.816883,
  "score_scale": "0-100 higher_is_better",
  "grade": "failed",
  "inputs": {
    "metrics_summary": "metrics_summary.json",
    "anomaly_candidates": "anomaly_candidates.json",
    "diagnosis": "diagnosis.json"
  },
  "config": {
    "allow_min_K": 250,
    "allow_max_K": 320,
    "target_K": 285,
    "max_anomaly_count": 0
  },
  "metrics": {
    "sample_count": 743,
    "anomaly_count": 743,
    "anomaly_ratio": 1,
    "min_K": 2.9999999816508605,
    "max_K": 4.281815702330134,
    "mean_K": 3.082415,
    "spread_K": 1.2818157206792737
  },
  "penalties": {
    "anomaly_penalty": 50,
    "range_penalty": 30,
    "spread_penalty": 0.183117,
    "mean_penalty": 10
  },
  "hard_failures": [
    "temperature_below_min",
    "anomaly_count_nonzero"
  ],
  "warnings": [
    "observed temperatures are far below normal electronics operating range; verify units and exported COMSOL variable"
  ]
}
```

## V2 Reviewer 设计

Reviewer 是 `design-iteration` skill 内部的审查协议，不是单独的执行层。它不计算分数，而是做结构化审查。

Reviewer 应检查：

- 候选操作是否违反用户约束。
- 是否遗漏必要 CAD validate。
- 是否遗漏 simulation doctor。
- `run_manifest.json` 是否 `ok: true`。
- `metrics_summary.json`、`anomaly_candidates.json`、`scoring_summary.json` 是否存在。
- 候选版本是否注册了关键 checkpoint。
- LLM 结论是否被 score 和 metrics 支撑。
- 是否存在明显单位异常，例如 `observed_K` 远低于合理工作温度。

Reviewer 输出建议结构：

```ts
type ReviewResult = {
  ok: boolean
  blockingIssues: string[]
  warnings: string[]
  evidencePaths: string[]
  checkpointIds: string[]
}
```

## V2 记忆和经验库

V2 可以积累跨 session 的经验，用于候选生成：

```ts
type DesignLesson = {
  id: string
  condition: string
  action: string
  outcome: string
  metricsBefore: Record<string, number>
  metricsAfter: Record<string, number>
  confidence: number
  sourceRunIds: string[]
}
```

第一阶段可以用 SQLite 表保存：

- historical runs
- scoring summaries
- failed runs
- successful fixes
- component-level anomaly patterns

后续可以加向量检索，用相似案例辅助 `design-iteration` 内部 Planner 生成候选。

## V2 API 扩展

在 V1 API 基础上增加：

```text
POST /api/candidate-sets
GET  /api/candidate-sets/:id
POST /api/candidate-sets/:id/cancel
POST /api/candidate-sets/:id/select
POST /api/candidate-sets/:id/rank
GET  /api/versions/:versionId/score
GET  /api/versions/:a/compare/:b
POST /api/runs/:runId/score
POST /api/checkpoints/register
```

`POST /api/candidate-sets` 输入：

```json
{
  "sessionId": "session_x",
  "baseVersionId": "v0003",
  "objective": {
    "goal": "keep_temperature_in_range",
    "constraints": [
      { "metric": "anomaly_count", "op": "==", "value": 0 }
    ],
    "candidateLimit": 3
  },
  "execution": {
    "mode": "parallel",
    "copyStrategy": "reflink_auto"
  }
}
```

## V2 落地顺序

1. 在 analysis 阶段后新增 deterministic scoring step。
2. 输出 `02_sim/analysis/scoring_summary.json`。
3. 将 score artifact 注册到 manifest。
4. 在版本列表中显示 `pass / score / grade`。
5. 增加独立 candidate workspace 创建能力，优先使用 `cp --reflink=auto`，不支持时 fallback 到普通复制。
6. 增加 `CandidateSetRecord`，并关联 version、run、checkpoint、score。
7. 用 SQLite transaction 保护 candidate set、version、run、artifact、checkpoint、score 的写入。
8. 扩展 `design-iteration` skill，增加 ObjectiveSpec 解析和候选生成协议。
9. 扩展 `design-iteration` skill，增加 reviewer 协议，检查候选和结论。
10. 增加候选版本并行或串行 skill run，确保每个候选只写自己的 workspace。
11. 增加版本对比 UI。
12. 增加历史经验库。
13. 最后再考虑自动多轮优化。

## 结论

最终设计不是让 Temporal 管理文件版本，也不是把现有 `freecad` / `simulation-skill` 翻译成规范化 Activity Adapter。

推荐关系是：

```text
design-iteration skill 规划整体流程
freecad / simulation-skill 完成领域任务
Manifest / SQLite 记录版本、run、artifact 和 score
session 记录用户和 LLM 说了什么
Temporal 只作为未来长任务可靠调度的可选增强项
```

这样既能复用现有 `freecad` 和 `simulation-skill`，又能补上多轮迭代、版本切换、失败恢复和多函数协作所需的系统能力。

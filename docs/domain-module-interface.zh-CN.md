# 领域模块接入接口

新领域模块必须按三层交付：**Skill、Python Package / CLI、Input Package**。三层职责固定，不能混用。

## 1. 三层职责

| 层 | 职责 | 不做什么 |
| --- | --- | --- |
| Skill | 判断意图、编排流程、检查门禁、调用 CLI、解释结果 | 不写核心算法，不直接生成核心产物 |
| Python Package / CLI | 执行领域逻辑、校验输入输出、写阶段产物、更新进度、返回 JSON | 不依赖对话上下文，不隐藏业务契约 |
| Input Package | 提供领域输入 schema、默认模板、最小可运行样例 | 不放运行日志、临时状态、推理过程 |

## 2. 必须交付目录

```text
open_codex_web/backend/workflow_agents/<domain>_skills/
open_codex_web/backend/workflow_agents/agents/<domain>_cli_tools/
data/<domain>/00_inputs/
```

推荐 workspace 结构：

```text
<workspace>/
  00_inputs/
  01_<stage>/
  02_<stage>/
  logs/
  reports/
```

复杂设计闭环领域可增加：

```text
<workspace>/<DOMAIN>_Workflow/
  01_inputs/
  02_analysis/
  03_config/
  04_validation/
  05_run/
  10_reports/
  workflow_log.md
  loop_progress.json
```

## 3. Workspace 使用接口

### 3.1 框架中 workspace 是什么

`workspace_dir` 是框架传给 Agent 和 CLI 的**当前版本工作区根目录**。它不是项目根目录，也不是默认模板目录。

任务运行时，后端会把 `workspace_id`、`version_id`、`workspace_dir`、`session_id`、`turn_id` 注入给 Agent。Skill 必须使用这个 `workspace_dir` 作为唯一工作区根目录。

版本化工作流中：

- `workspace_dir` 指向当前 active version，例如 `.../workspaces/ws_thermal/versions/v0002`。
- checkout/branch 只改变 workspace manifest 的 active version，不会改 `config.json`。
- CLI 如果支持 `--workspace-dir`，必须显式传入该路径。
- 不要依赖进程 `cwd` 或 `config.json` 推断当前工作区。

### 3.2 workspace 中目录怎么用

| 路径 | 用途 |
| --- | --- |
| `<workspace>/00_inputs/` | 当前版本的可变输入包，CLI 默认从这里读输入 |
| `<workspace>/01_<stage>/` | 第一阶段产物，例如 CAD、预处理、配置生成 |
| `<workspace>/02_<stage>/` | 第二阶段产物，例如仿真、运行、分析 |
| `<workspace>/logs/` | 进度、运行日志、会话辅助信息 |
| `<workspace>/logs/progress.json` | 前端和托管任务读取的长任务进度 |
| `<workspace>/reports/` | 面向用户的报告、诊断报告、总结 |
| `<workspace>/<DOMAIN>_Workflow/` | 可选；复杂领域的设计过程、阶段证据、闭环审计 |

领域模块不得把核心产物写到仓库源码目录或默认模板目录。默认模板只用于创建 workspace，任务运行时读写 active `workspace_dir`。

### 3.3 Input Package 和 workspace 的关系

默认输入包位置：

```text
data/<domain>/00_inputs/
```

创建或切换版本后，框架使用 workspace 中的副本：

```text
<workspace>/00_inputs/
```

因此 skill 和 CLI 应该只读写 `<workspace>/00_inputs/`。除非用户明确要求修改默认模板，否则不要修改 `data/<domain>/00_inputs/`。

### 3.4 CLI 中应该怎么用 workspace

所有 workspace-scoped 命令必须支持：

```bash
--workspace-dir <workspace>
```

Skill 调用 CLI 时必须显式传入：

```bash
python -m <domain>_cli_tools.cli.main doctor --workspace-dir <workspace_dir> --json
python -m <domain>_cli_tools.cli.main run --workspace-dir <workspace_dir> --json
```

CLI 内部路径必须从 `workspace_dir` 派生：

```text
input_dir = <workspace_dir>/00_inputs
log_dir = <workspace_dir>/logs
report_dir = <workspace_dir>/reports
stage_dir = <workspace_dir>/<stage>
```

禁止从 `cwd` 拼 `00_inputs`、从 `config.json` 猜 workspace、搜索同名输入文件，或把产物写回默认模板目录。

### 3.5 Skill 中应该怎么写 workspace 规则

每个领域 skill 都应包含类似规则：

```markdown
## Workspace Rules

- Resolve `workspace_dir` from the execution context.
- Treat `workspace_dir` as the active version workspace root.
- Read mutable inputs from `workspace_dir/00_inputs`.
- Write stage outputs only under `workspace_dir/<stage_dir>`.
- Write long-running progress to `workspace_dir/logs/progress.json`.
- Pass `--workspace-dir <workspace_dir>` to every CLI that supports it.
- Do not rely on process `cwd` or `config.json` for versioned work.
- Do not edit the default template input package unless the user explicitly asks.
```

复杂设计闭环领域还应写：

```markdown
- Store process artifacts under `workspace_dir/<DOMAIN>_Workflow/<stage_id>/`.
- Append externally useful status to `workspace_dir/<DOMAIN>_Workflow/workflow_log.md`.
- Update machine-readable loop state in `workspace_dir/<DOMAIN>_Workflow/loop_progress.json`.
- Copy final runtime-ready inputs back to `workspace_dir/00_inputs` only after validation passes.
```

### 3.6 前端怎么使用 workspace

前端通常通过 `workspaceDir`、`workspaceId`、`versionId` 读取工作区文件：

- 文件、BOM、模型视图会把 `workspaceDir` 传给后端 API。
- 进度视图读取 `<workspace>/logs/progress.json`。
- 专属可视化页面应只读取 workspace 内的产物。

所以新领域应优先保证 workspace 产物稳定；只有通用文件预览不够时，再新增专属 UI。

## 4. Skill 接口

每个 `SKILL.md` 必须说明：

- 什么时候使用
- 需要哪些输入文件
- 前置条件和阶段门禁
- 调用哪些 CLI 命令
- 写出哪些产物
- 失败时看哪些日志、如何停止或重试
- 如何更新进度

Skill 只能做流程和规则，核心执行必须交给 CLI。

## 5. CLI 接口

Package 目录至少包含：

```text
pyproject.toml
README.md
src/<domain>_cli_tools/cli/main.py
src/<domain>_cli_tools/workspace.py
src/<domain>_cli_tools/validation.py
src/<domain>_cli_tools/progress.py
tests/
```

必须支持：

```bash
python -m <domain>_cli_tools.cli.main doctor --workspace-dir <workspace> --json
python -m <domain>_cli_tools.cli.main validate --workspace-dir <workspace> --json
python -m <domain>_cli_tools.cli.main run --workspace-dir <workspace> --json
python -m <domain>_cli_tools.cli.main report --workspace-dir <workspace> --json
```

JSON 返回格式：

```json
{
  "ok": true,
  "workspace_dir": "/abs/workspace",
  "stage": "run",
  "status": "completed",
  "outputs": {},
  "summary": {},
  "errors": [],
  "warnings": []
}
```

失败时 `ok=false`，`errors` 必须包含 `code`、`message`，最好包含 `path`。

长任务必须更新：

```text
<workspace>/logs/progress.json
```

状态值统一使用：

```text
pending | running | completed | failed | blocked
```

## 6. 验收标准

新领域接入完成必须满足：

1. 默认 `00_inputs` 能创建 workspace。
2. `doctor --json` 能检查输入完整性。
3. `validate --json` 能检查 schema 和业务规则。
4. `run --json` 能生成产物或明确失败原因。
5. `report --json` 能生成报告或诊断报告。
6. 长任务能写 `logs/progress.json`。
7. Skill 只调用稳定 CLI，不写核心执行逻辑。
8. README 写清最小运行命令和产物位置。

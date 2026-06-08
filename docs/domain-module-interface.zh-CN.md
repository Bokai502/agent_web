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
<workspace>/<DOMAIN>_Workflow/
  01_inputs/
  02_analysis/
  03_config/
  04_validation/
  05_run/
  10_reports/
  logs/
  reports/
```

## 3. Skill 接口

每个 `SKILL.md` 必须说明：

- 什么时候使用
- 需要哪些输入文件
- 前置条件和阶段门禁
- 调用哪些 CLI 命令
- 写出哪些产物
- 失败时看哪些日志、如何停止或重试
- 如何更新进度

Skill 只能做流程和规则，核心执行必须交给 CLI。

## 4. CLI 接口

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

## 5. Input Package 接口

默认输入目录：

```text
data/<domain>/00_inputs/
```

必须包含：

```text
README.md
manifest.json
```

`manifest.json` 至少包含：

```json
{
  "schema_version": "domain_input_manifest/1.0",
  "domain": "<domain>",
  "required_files": [],
  "optional_files": [],
  "entry_command": "python -m <domain>_cli_tools.cli.main doctor --workspace-dir <workspace>"
}
```

输入文件必须有 schema version、单位/坐标/时间等基础语义，并能被 `doctor` 或 `validate` 检查。

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

## 8. 参考

Thermal：执行型流水线参考。

```text
thermal_skills/
agents/freecad_cli_tools/
agents/sim_cli_tools/
data/input_data/thermal/00_inputs/
```

GNC：设计闭环和审计流程参考。

```text
gnc_skills/
AIGNC/AGENT.md
data/input_data/gnc/00_inputs/
```

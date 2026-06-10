# CATCH GNC Skills Mirror

This directory keeps only the skills that were actually used in the CATCH GNC / AIGNC design-and-run workflow.

Use workspace-local directory and modification rules from `codex_web/AIGNC/AGENT.md` before applying any skill in this mirror.

During GNC design workflows, skills must append externally useful step-level status to `<workspace>/AIGNC_Workflow/workflow_log.md`. Log skill start, each meaningful internal checklist step or small stage action, blockers, and completion or handoff. Do not log private reasoning; record timestamp, numbered stage, current skill, step id or step name, status, concise description, key input artifacts checked, key output artifacts written or updated, and next action or handoff target when known.

Skills must also update `<workspace>/AIGNC_Workflow/loop_progress.json` as machine-readable progress using schema `loop_progress/1.0`. Use loop name `<stage_id>` and update at skill start, after each meaningful checklist step, on blockers or failures, and on completion or handoff. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Use the shared updater:

```bash
python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py \
  --progress <workspace>/AIGNC_Workflow/loop_progress.json \
  --loop-name <stage_id> \
  --stage <stage_id> \
  --skill <skill_name> \
  --status running \
  --percentage 50 \
  --note "正在检查阶段输入"
```

`note` is the frontend-display current-state text for the stage. It is mandatory for every loop progress update and is intended to be shown directly as the small status line below the stage name.

Write `note` as one concise user-facing Chinese sentence or phrase, no more than 80 characters. It must describe the current visible stage state only: what is being checked, generated, waiting for, blocked by, failed, completed, or handed off. Do not include Markdown, tables, bullets, JSON, logs, raw stack traces, file paths, absolute paths, percentages, timestamps, private reasoning, or multi-step explanations.

Use these status-specific meanings:

- `running`: current action, for example `正在验证 42 配置引用`
- `blocked`: blocker and required resolution, for example `等待确认姿态目标坐标定义`
- `failed`: failure summary without raw logs, for example `构建失败，正在定位编译错误`
- `completed`: completion result or handoff, for example `配置校验通过，进入运行验证`
- `pending`: waiting state, for example `等待上游阶段输出`

Keep durable details, evidence paths, command output, and longer explanations in `<workspace>/AIGNC_Workflow/workflow_log.md` or stage artifacts, not in `note`.

Included skills:
- 42-build-run-diagnose
- 42-capability-auditor
- 42-config-author
- 42-config-validator
- 42-runtime-plotter
- aignc-design-closure-auditor
- aignc-scenario-brainstorm
- fsw-architecture-planner
- fsw-code-author
- fsw-requirements-extractor
- fsw-tuning-reviewer

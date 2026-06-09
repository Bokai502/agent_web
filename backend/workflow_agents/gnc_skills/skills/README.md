# CATCH GNC Skills Mirror

This directory keeps only the skills that were actually used in the CATCH GNC / AIGNC design-and-run workflow.

Use workspace-local directory and modification rules from `codex_web/AIGNC/AGENT.md` before applying any skill in this mirror.

During GNC design workflows, skills must append externally useful step-level status to `<workspace>/AIGNC_Workflow/workflow_log.md`. Log skill start, each meaningful internal checklist step or small stage action, blockers, and completion or handoff. Do not log private reasoning; record timestamp, numbered stage, current skill, step id or step name, status, concise description, key input artifacts checked, key output artifacts written or updated, and next action or handoff target when known.

Skills must also update `<workspace>/AIGNC_Workflow/loop_progress.json` as machine-readable progress using schema `loop_progress/1.0`. Use loop name `<stage_id>_<skill_name>` and update at skill start, after each meaningful checklist step, on blockers or failures, and on completion or handoff. Use the shared updater:

```bash
python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py \
  --progress <workspace>/AIGNC_Workflow/loop_progress.json \
  --loop-name <stage_id>_<skill_name> \
  --stage <stage_id> \
  --skill <skill_name> \
  --status running \
  --percentage 50
```

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

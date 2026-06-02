# Agent 语音流程实现说明

本文档总结当前未提交代码中，Agent 页面和语音任务流程相关的主要改动。

## 总览

原来的 Whisper 单页已经替换为完整的 Agent 页面。新流程支持浏览器录音、Whisper 语音识别、managed Codex 任务派发、skill 路由、后台任务状态流、进度/结果总结，以及 TTS 语音播报。

语音入口链路如下：

1. 前端录制麦克风音频，并编码为 WAV 上传到 `/api/whisper/transcribe`。
2. Whisper 返回识别文本。
3. 前端把识别文本派发到 `/api/run/managed/dispatch`。
4. 后端通过 Responses API 调用 `intent-router` routing skill 做任务分类。
5. 后端启动 managed Codex run，并立即返回 `started` 状态。
6. 前端播放固定接收播报：`当前任务已接收，正在分析。`
7. managed run 在后台继续执行，并通过 SSE 发布状态。
8. 任务完成后，后端基于当前 turn 的 agent message 和 `logs/progress.json` 总结结果。
9. 前端通过 CosyVoice TTS 播放最终总结。

## 前端改动

旧的 `WhisperPage` 已移除，替换为 `AgentPage`。

主要文件：

- `frontend/src/pages/AgentPage.tsx`
- `frontend/src/pages/AgentPage.css`
- `frontend/src/pages/agent/useAgentRecorder.ts`
- `frontend/src/pages/agent/useAgentSpeech.ts`
- `frontend/src/pages/agent/managedRun.ts`
- `frontend/src/pages/agent/AgentRecorderControl.tsx`
- `frontend/src/pages/agent/AgentVoiceExchange.tsx`
- `frontend/src/pages/agent/AgentWorkspacePanel.tsx`
- `frontend/src/pages/agent/AgentProgressRail.tsx`
- `frontend/src/pages/agent/AgentConversationPopover.tsx`

Agent 页面现在包含：

- 浏览器录音和本地 WAV 编码。
- Whisper 语音识别上传。
- managed run 派发、状态轮询和 SSE 订阅。
- 工作区、版本、BOM、日志、文件预览、生成产物展示。
- CAD、ParaView、COMSOL 远程工具入口。
- AI 语音播放状态和可见回复文本状态。

固定接收播报不再每次实时合成。当播报文本正好是 `当前任务已接收，正在分析。` 时，前端会优先请求：

```text
/api/agent/audio/task-accepted
```

如果该音频请求失败，再回退到：

```text
/api/cosyvoice/tts-stream
```

## 后端 Managed Run 改动

managed run 相关逻辑新增在 `backend/src/codex-run` 下。

主要文件：

- `backend/src/codex-run/agentOrchestrator.ts`
- `backend/src/codex-run/codexTurn.ts`
- `backend/src/codex-run/intentRouter.ts`
- `backend/src/codex-run/managed.routes.ts`
- `backend/src/codex-run/index.ts`
- `backend/src/codex-run/run.routes.ts`

新增 managed run 接口：

```text
POST /api/run/managed/dispatch
GET  /api/run/managed/status/:managedRunId
GET  /api/run/managed/events/:managedRunId
```

`runAgentTurn()` 负责 managed run 的高层编排：

- 规范化请求输入和工作区上下文。
- 对用户输入做任务分类。
- 对普通任务快速返回 `started` 响应。
- 在后台执行 Codex。
- 保存任务状态和事件 backlog。
- 发布 started、status、final、failed 事件。
- 将状态快照持久化到 `backend/logs/managed-runs`。

固定开始总结为：

```text
当前任务已接收，正在分析。
```

该文本会在后台任务启动后立即返回给前端，并触发前端播放预生成音频。

## Routing Skills

新增两个 routing skill：

- `backend/workflow_agents/routing_skills/intent-router/SKILL.md`
- `backend/workflow_agents/routing_skills/pipeline-progress-summarizer/SKILL.md`

`intent-router` 用于把用户输入分类为：

- 普通任务
- 热仿真/热设计工作流
- GNC/AIGNC 工作流
- 进度或历史结果查询

它返回严格 JSON，例如：

```json
{
  "managedSkills": ["task-runner"],
  "selectedSkills": [],
  "skillScopes": ["public"]
}
```

`pipeline-progress-summarizer` 只基于以下信息生成任务完成总结：

- 当前 turn 中的 `agent_message`
- `logs/progress.json` 的摘要

该 skill 已要求避免输出 `上下文未提供`、`没有证据`、`未显示`、`无法确认` 等内部判断话术。

## Responses API 使用

轻量分类和总结不再使用 Codex SDK thread，而是直接通过 `fetch` 调用 Responses API。

Responses API 用于：

- `managed-intent-routing`：任务分类
- `managed-progress-answer`：进度/历史问答
- `managed-final-speech-summary`：最终语音总结
- `managed-pipeline-completion-summary`：pipeline 完成总结

真正执行任务仍然使用 Codex SDK，因为这一路需要 agent 执行、skill 上下文、工作区处理和事件收集。

Responses API 日志在 `backend/logs/app.log` 中有明确标识：

```text
responses api request started
responses api request completed
responses api request failed
```

每条日志包含：

- `apiKind: "responses"`
- `apiRoute: "/responses"`
- `purpose`
- `model`
- `requestId`
- `promptLength`
- `maxOutputTokens`
- `latencyMs`
- `outputLength`
- `status`

可用以下命令过滤：

```bash
rg 'apiKind":"responses' backend/logs/app.log
```

## TTS 和音频改动

CosyVoice 路由现在支持：

- TTS stream。
- TTS stream 短期内存缓存。
- 服务预生成的任务接收播报音频。

新增音频文件：

```text
docs/agent-task-accepted.wav
```

新增接口：

```text
GET /api/agent/audio/task-accepted
```

该接口以 `audio/wav` 类型返回 `docs/agent-task-accepted.wav`，并设置浏览器缓存头。

## Whisper 改动

Whisper 路由现在直接处理 Agent 语音输入上传。旧的 `backend/src/whisper/task.ts` 路径已删除。

前端会将录制好的 WAV blob 发送到：

```text
POST /api/whisper/transcribe
```

请求头包含：

```text
X-Whisper-Language: zh-en
```

## 进度和工作区展示

工作区相关后端接口和前端工具函数已更新，使 Agent 页面可以展示当前工作区状态、生成文件、日志、进度和会话历史。

主要涉及：

- `backend/src/workspaces/workspaceData.routes.ts`
- `backend/src/workspaces/stageLogs.routes.ts`
- `frontend/src/pages/workspace/useWorkspaceRuntimeData.ts`
- `frontend/src/pages/workspace/GeneratedFilesTreeCard.tsx`
- `frontend/src/pages/workspace/ConversationLogView.tsx`
- `frontend/src/pages/agent/useWorkspaceFilePreview.ts`
- `frontend/src/pages/agent/workspaceFileUtils.ts`

## 当前行为

新语音任务流程：

1. 用户结束录音。
2. Whisper 完成语音识别。
3. 前端发起 managed dispatch。
4. 前端播放预生成的任务接收播报。
5. Codex 在后台执行分类后的任务。
6. 前端通过 managed run events/status 收到最终状态。
7. 后端使用 Responses API 生成结果总结。
8. 前端通过 CosyVoice 播放最终总结。

进度查询流程：

1. `intent-router` 选择 `progress-summarizer`。
2. 后端读取最近 managed 状态、对话、manifest runs、产物和 progress。
3. Responses API 生成简短回答。
4. 如果模型调用失败，后端返回本地快速进度总结。

## 说明

- 固定任务接收播报使用静态音频，目的是降低延迟并保持播报稳定。
- 最终任务总结仍然根据真实任务上下文动态生成。
- Responses API 失败是可恢复的，managed summary 相关失败会以 warn 记录。
- intent routing 失败会回退到 `general` 和 `task-runner`。
- pipeline summary 的输入刻意保持较小，以减少延迟并避免引入无关上下文。

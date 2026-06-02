# Agent Voice Flow Implementation

This document summarizes the current uncommitted Agent page and voice workflow changes.

## Overview

The old Whisper-only page has been replaced by a full Agent page. The new flow supports browser recording, Whisper transcription, managed Codex task dispatch, skill-based routing, background task status streaming, progress/result summarization, and TTS playback.

The voice entry flow is:

1. The frontend records microphone audio and uploads a WAV blob to `/api/whisper/transcribe`.
2. Whisper returns transcribed text.
3. The frontend dispatches the text to `/api/run/managed/dispatch`.
4. The backend classifies the task with the `intent-router` routing skill through the Responses API.
5. The backend starts a managed Codex run and immediately returns a `started` status.
6. The frontend plays the fixed acknowledgement audio: `当前任务已接收，正在分析。`
7. The managed run continues in the background and publishes status through SSE.
8. When the run completes, the backend summarizes the result from the current turn agent messages and `logs/progress.json`.
9. The frontend plays the final generated summary through CosyVoice TTS.

## Frontend Changes

The previous `WhisperPage` was removed and replaced by `AgentPage`.

Main files:

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

The Agent page now includes:

- Voice recording and local WAV encoding.
- Whisper transcription upload.
- Managed run dispatch and status polling/SSE subscription.
- Workspace, version, BOM, log, file preview, and generated artifact panels.
- Remote tool entries for CAD, ParaView, and COMSOL.
- Voice playback state and visible AI response state.

The fixed acknowledgement speech is no longer synthesized every time. When the text is exactly `当前任务已接收，正在分析。`, the frontend first requests:

```text
/api/agent/audio/task-accepted
```

If that file request fails, it falls back to:

```text
/api/cosyvoice/tts-stream
```

## Backend Managed Run Changes

Managed runs were added under `backend/src/codex-run`.

Main files:

- `backend/src/codex-run/agentOrchestrator.ts`
- `backend/src/codex-run/codexTurn.ts`
- `backend/src/codex-run/intentRouter.ts`
- `backend/src/codex-run/managed.routes.ts`
- `backend/src/codex-run/index.ts`
- `backend/src/codex-run/run.routes.ts`

New managed run endpoints:

```text
POST /api/run/managed/dispatch
GET  /api/run/managed/status/:managedRunId
GET  /api/run/managed/events/:managedRunId
```

`runAgentTurn()` handles the high-level managed flow:

- Normalize request input and workspace context.
- Classify the request.
- Return a fast `started` response for normal tasks.
- Run Codex in the background.
- Store status and event backlog.
- Publish started, status, final, and failed events.
- Persist status snapshots under `backend/logs/managed-runs`.

The fixed start summary is:

```text
当前任务已接收，正在分析。
```

This is returned immediately for background managed tasks and is what triggers the pre-generated acknowledgement audio on the frontend.

## Routing Skills

Two routing skills were added:

- `backend/workflow_agents/routing_skills/intent-router/SKILL.md`
- `backend/workflow_agents/routing_skills/pipeline-progress-summarizer/SKILL.md`

The intent router classifies user input into:

- General task
- Thermal workflow
- GNC/AIGNC workflow
- Progress/history query

It returns strict JSON with:

```json
{
  "managedSkills": ["task-runner"],
  "selectedSkills": [],
  "skillScopes": ["public"]
}
```

The pipeline progress summarizer summarizes only:

- Current turn `agent_message` entries
- The digest of `logs/progress.json`

It is instructed to avoid internal phrases such as `上下文未提供`, `没有证据`, `未显示`, and `无法确认`.

## Responses API Usage

Lightweight classification and summarization no longer use Codex SDK threads. They call the Responses API directly with `fetch`.

Responses API is used for:

- `managed-intent-routing`
- `managed-progress-answer`
- `managed-final-speech-summary`
- `managed-pipeline-completion-summary`

The actual task execution still uses Codex SDK, because that path needs agent execution, skill context, workspace handling, and event collection.

Responses API logs are explicitly marked in `backend/logs/app.log`:

```text
responses api request started
responses api request completed
responses api request failed
```

Each log includes:

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

Useful filter:

```bash
rg 'apiKind":"responses' backend/logs/app.log
```

## TTS And Audio Changes

CosyVoice routes now support:

- TTS streaming
- In-memory TTS stream cache
- Serving the pre-generated acknowledgement audio

New audio file:

```text
docs/agent-task-accepted.wav
```

New endpoint:

```text
GET /api/agent/audio/task-accepted
```

The endpoint serves `docs/agent-task-accepted.wav` with `audio/wav` content type and browser cache headers.

## Whisper Changes

The Whisper route now handles direct transcription upload for Agent voice input. The older `backend/src/whisper/task.ts` path was removed.

The frontend sends the recorded WAV blob to:

```text
POST /api/whisper/transcribe
```

with:

```text
X-Whisper-Language: zh-en
```

## Progress And Workspace Display

Workspace-related routes and frontend utilities were updated so the Agent page can display current workspace state, generated files, logs, progress, and conversation history.

Main touched areas:

- `backend/src/workspaces/workspaceData.routes.ts`
- `backend/src/workspaces/stageLogs.routes.ts`
- `frontend/src/pages/workspace/useWorkspaceRuntimeData.ts`
- `frontend/src/pages/workspace/GeneratedFilesTreeCard.tsx`
- `frontend/src/pages/workspace/ConversationLogView.tsx`
- `frontend/src/pages/agent/useWorkspaceFilePreview.ts`
- `frontend/src/pages/agent/workspaceFileUtils.ts`

## Current Behavior

For a new voice task:

1. User stops recording.
2. Whisper transcribes the audio.
3. Managed dispatch starts.
4. The frontend plays the pre-generated acknowledgement audio.
5. Codex runs the routed task in the background.
6. The frontend receives final status through managed run events/status.
7. The backend summarizes the result using Responses API.
8. The frontend plays the final summary through CosyVoice.

For a progress query:

1. The intent router selects `progress-summarizer`.
2. The backend reads recent managed status, conversation, manifest runs, artifacts, and progress.
3. Responses API generates a concise answer.
4. If the model call fails, the backend returns a local fast progress summary.

## Notes

- The fixed acknowledgement audio is intentionally static for speed and consistency.
- Final task summaries are generated dynamically from task context.
- Responses API failures are recoverable and logged as warnings for managed summaries.
- Intent routing failure falls back to `general` plus `task-runner`.
- Pipeline summary input is intentionally small to reduce latency and avoid unrelated context.

import path from "node:path"
import {
  findWorkspaceSession,
  upsertWorkspaceSessionHistory,
} from "../sessions/sessionStore.js"

type SessionRecord = {
  createdAt?: number
  dismissedAskUserId?: string | null
  id?: string
  threadId?: string | null
  title?: string
  turns?: Array<{ id?: string; userPrompt?: string; events?: unknown[] }>
  versionId?: string | null
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
}

function getWorkspaceName(workspaceDir: string | null) {
  return workspaceDir ? path.basename(workspaceDir) : null
}

export async function ensureRunSession({
  prompt,
  sessionId,
  threadId,
  versionId,
  workspaceDir,
  workspaceId,
  workspaceName,
}: {
  prompt: string
  sessionId: string
  threadId: string | null
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
  workspaceName: string | null
}) {
  const resolvedWorkspaceName = workspaceName ?? getWorkspaceName(workspaceDir)
  const existing = await findWorkspaceSession(sessionId, workspaceDir) as SessionRecord | null

  if (existing) {
    await upsertWorkspaceSessionHistory({
      ...existing,
      threadId: existing.threadId ?? threadId,
      workspaceId: workspaceId ?? existing.workspaceId ?? null,
      versionId: versionId ?? existing.versionId ?? null,
      workspaceDir: workspaceDir ?? existing.workspaceDir ?? null,
      workspaceName: resolvedWorkspaceName ?? existing.workspaceName ?? null,
    })
  } else {
    await upsertWorkspaceSessionHistory({
      id: sessionId,
      title: prompt.slice(0, 60),
      threadId,
      turns: [],
      createdAt: Date.now(),
      dismissedAskUserId: null,
      workspaceId,
      versionId,
      workspaceDir,
      workspaceName: resolvedWorkspaceName,
    })
  }
}

export async function completeRunSessionTurn({
  events,
  prompt,
  sessionId,
  threadId,
  turnId,
  versionId,
  workspaceDir,
  workspaceId,
  workspaceName,
}: {
  events: unknown[]
  prompt: string
  sessionId: string
  threadId: string | null
  turnId: string
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
  workspaceName: string | null
}) {
  const resolvedWorkspaceName = workspaceName ?? getWorkspaceName(workspaceDir)
  const turn = { id: turnId, userPrompt: prompt, events }
  const existing = await findWorkspaceSession(sessionId, workspaceDir) as SessionRecord | null

  if (existing) {
    const turns = Array.isArray(existing.turns) ? existing.turns : []
    const nextTurns = turns.some(item => item.id === turnId)
      ? turns.map(item => item.id === turnId ? turn : item)
      : [...turns, turn]
    await upsertWorkspaceSessionHistory({
      ...existing,
      threadId: threadId ?? existing.threadId ?? null,
      turns: nextTurns,
      workspaceId: workspaceId ?? existing.workspaceId ?? null,
      versionId: versionId ?? existing.versionId ?? null,
      workspaceDir: workspaceDir ?? existing.workspaceDir ?? null,
      workspaceName: resolvedWorkspaceName ?? existing.workspaceName ?? null,
    })
  } else {
    await upsertWorkspaceSessionHistory({
      id: sessionId,
      title: prompt.slice(0, 60),
      threadId,
      turns: [turn],
      createdAt: Date.now(),
      dismissedAskUserId: null,
      workspaceId,
      versionId,
      workspaceDir,
      workspaceName: resolvedWorkspaceName,
    })
  }
}

export async function persistRunSessionTurn(args: Parameters<typeof completeRunSessionTurn>[0]) {
  await completeRunSessionTurn(args)
}

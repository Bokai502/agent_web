import type { AskUserItem, Session, ThreadEvent, Turn } from "../../types"
import type { WorkspaceVersionContext } from "./workspaceVersion"

export type WorkspaceSessionStatus = "running" | "completed" | "failed" | "loaded" | "waiting"

export function sessionMatchesWorkspace(session: Session | null | undefined, activeContext: WorkspaceVersionContext) {
  if (!session) return false
  const currentWorkspaceDir = activeContext.versionDir?.trim().replace(/[\\/]+$/u, "") ?? null
  const sessionWorkspaceDir = session.workspaceDir?.trim().replace(/[\\/]+$/u, "") ?? null
  if (currentWorkspaceDir && sessionWorkspaceDir === currentWorkspaceDir) return true
  return !!activeContext.workspaceId && !!activeContext.versionId &&
    session.workspaceId === activeContext.workspaceId &&
    session.versionId === activeContext.versionId
}

export function getSessionCompletionStatus(session: Session | null | undefined): WorkspaceSessionStatus {
  const lastTurn = session?.turns.at(-1)
  const terminalEvent = lastTurn?.events.findLast(event =>
    event.type === "turn.completed" || event.type === "turn.failed",
  )
  if (terminalEvent?.type === "turn.completed") return "completed"
  if (terminalEvent?.type === "turn.failed") return "failed"
  return session ? "loaded" : "waiting"
}

export function getVisibleWorkspaceSessionState({
  activeContext,
  activeSession,
  currentEvents,
  currentPrompt,
  pendingAskUser,
  running,
  runningWorkspace,
  turns,
}: {
  activeContext: WorkspaceVersionContext
  activeSession: Session | null | undefined
  currentEvents: ThreadEvent[]
  currentPrompt: string
  pendingAskUser: AskUserItem | null
  running: boolean
  runningWorkspace: Pick<Session, "workspaceDir" | "workspaceId" | "versionId"> | null | undefined
  turns: Turn[]
}) {
  const activeSessionMatchesWorkspace = sessionMatchesWorkspace(activeSession, activeContext)
  const runningMatchesWorkspace = sessionMatchesWorkspace(runningWorkspace as Session | null | undefined, activeContext)
  const visibleRunning = running && runningMatchesWorkspace
  const sessionStatus = visibleRunning
    ? "running"
    : activeSessionMatchesWorkspace
      ? getSessionCompletionStatus(activeSession)
      : "waiting"
  return {
    activeSessionMatchesWorkspace,
    sessionStatus,
    visibleCurrentEvents: runningMatchesWorkspace ? currentEvents : [],
    visibleCurrentPrompt: runningMatchesWorkspace ? currentPrompt : "",
    visiblePendingAskUser: activeSessionMatchesWorkspace ? pendingAskUser : null,
    visibleRunning,
    visibleTurns: activeSessionMatchesWorkspace ? turns : [],
  }
}

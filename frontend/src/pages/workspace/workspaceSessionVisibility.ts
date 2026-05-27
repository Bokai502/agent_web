import type { AskUserItem, Session, ThreadEvent, Turn } from "../../types"
import type { WorkspaceVersionContext } from "./workspaceVersion"

export function sessionMatchesWorkspace(session: Session | null | undefined, activeContext: WorkspaceVersionContext) {
  if (!session) return false
  const currentWorkspaceDir = activeContext.versionDir?.trim().replace(/[\\/]+$/u, "") ?? null
  const sessionWorkspaceDir = session.workspaceDir?.trim().replace(/[\\/]+$/u, "") ?? null
  return currentWorkspaceDir
    ? sessionWorkspaceDir === currentWorkspaceDir
    : !!activeContext.workspaceId && !!activeContext.versionId &&
      session.workspaceId === activeContext.workspaceId &&
      session.versionId === activeContext.versionId
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
  return {
    activeSessionMatchesWorkspace,
    visibleCurrentEvents: runningMatchesWorkspace ? currentEvents : [],
    visibleCurrentPrompt: runningMatchesWorkspace ? currentPrompt : "",
    visiblePendingAskUser: activeSessionMatchesWorkspace ? pendingAskUser : null,
    visibleRunning: running && runningMatchesWorkspace,
    visibleTurns: activeSessionMatchesWorkspace ? turns : [],
  }
}

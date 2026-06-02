import { useCallback, useEffect, useMemo, useState } from "react"
import type { TFunction } from "i18next"
import { joinApiPath } from "../../app/apiBase"
import {
  getWorkflowLoopProgressEntries,
  type WorkflowProgressVariant,
  type WorkspaceProgressResponse,
} from "./progressUtils"
import {
  getDisplayLogEntries,
  getRunLogEntries,
  type ConversationLogEntry,
  type StageLogEntry,
} from "./runLogUtils"
import type { WorkspaceVersionContext } from "./workspaceVersion"
import type { ThreadEvent, Turn } from "../../types"

type RuntimeDataArgs = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
  progressRefreshNonce: number
  progressVariant: WorkflowProgressVariant
  running: boolean
  t: TFunction
  visibleCurrentEvents: ThreadEvent[]
  visibleTurns: Turn[]
  workspaceRefreshNonce: number
  sessionId?: string | null
}

function buildWorkspaceQuery(activeContext: WorkspaceVersionContext, sessionId?: string | null) {
  if (!activeContext.versionDir) return ""
  return `?${new URLSearchParams({
    workspaceDir: activeContext.versionDir,
    ...(activeContext.workspaceId ? { workspaceId: activeContext.workspaceId } : {}),
    ...(activeContext.versionId ? { versionId: activeContext.versionId } : {}),
    ...(sessionId ? { sessionId } : {}),
  }).toString()}`
}

export function useWorkspaceRuntimeData({
  activeContext,
  apiBase,
  progressRefreshNonce,
  progressVariant,
  running,
  t,
  visibleCurrentEvents,
  visibleTurns,
  workspaceRefreshNonce,
  sessionId,
}: RuntimeDataArgs) {
  const [progressData, setProgressData] = useState<WorkspaceProgressResponse | null>(null)
  const [stageLogs, setStageLogs] = useState<StageLogEntry[]>([])
  const [conversationLogs, setConversationLogs] = useState<ConversationLogEntry[]>([])
  const resetProgressData = useCallback(() => setProgressData(null), [])

  useEffect(() => {
    let cancelled = false

    const loadProgress = () => {
      if (!activeContext.versionDir) {
        setProgressData(null)
        return
      }
      fetch(`${joinApiPath(apiBase, "/workspace/progress")}${buildWorkspaceQuery(activeContext, sessionId)}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<WorkspaceProgressResponse> : null)
        .then(data => {
          if (!cancelled) setProgressData(data)
        })
        .catch(() => {
          if (!cancelled) setProgressData(null)
        })
    }

    loadProgress()
    const intervalId = window.setInterval(loadProgress, running ? 500 : 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, progressRefreshNonce, running, sessionId, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    const loadStageLogs = () => {
      if (!activeContext.versionDir) {
        setStageLogs([])
        return
      }
      fetch(`${joinApiPath(apiBase, "/logs/stages")}${buildWorkspaceQuery(activeContext)}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<StageLogEntry[]> : [])
        .then(data => {
          if (!cancelled) setStageLogs(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (!cancelled) setStageLogs([])
        })
    }

    loadStageLogs()
    const intervalId = window.setInterval(loadStageLogs, 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    const loadConversationLogs = () => {
      if (!activeContext.versionDir) {
        setConversationLogs([])
        return
      }
      fetch(`${joinApiPath(apiBase, "/logs/conversation")}${buildWorkspaceQuery(activeContext)}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<ConversationLogEntry[]> : [])
        .then(data => {
          if (!cancelled) setConversationLogs(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (!cancelled) setConversationLogs([])
        })
    }

    loadConversationLogs()
    const intervalId = window.setInterval(loadConversationLogs, 3000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, workspaceRefreshNonce])

  const runLogEntries = useMemo(() => getRunLogEntries(visibleTurns, visibleCurrentEvents, t), [visibleCurrentEvents, t, visibleTurns])
  const logEntries = useMemo(() => getDisplayLogEntries(stageLogs, conversationLogs, runLogEntries), [conversationLogs, runLogEntries, stageLogs])
  const workflowLoopProgressEntries = useMemo(
    () => getWorkflowLoopProgressEntries(progressData?.data, t, progressVariant),
    [progressData, progressVariant, t],
  )

  return {
    logEntries,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
  }
}

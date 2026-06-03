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

const MAX_STAGE_LOG_ENTRIES = 120
const MAX_CONVERSATION_LOG_ENTRIES = 8
const CONVERSATION_SESSION_LIMIT = 4
const CONVERSATION_TURN_LIMIT = 40
const CONVERSATION_EVENT_LIMIT = 120

type RuntimeDataArgs = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
  enableConversationLogRefresh?: boolean
  enableConversationLogs?: boolean
  enableRunLogEntries?: boolean
  enableStageLogs?: boolean
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

function appendQueryParams(query: string, params: Record<string, string | number>) {
  const searchParams = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query)
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value))
  }
  const value = searchParams.toString()
  return value ? `?${value}` : ""
}

function haveSameLogEntries<TEntry extends { detail?: string; id: string; status?: string; time?: string }>(previous: TEntry[], next: TEntry[]) {
  if (previous.length !== next.length) return false
  return previous.every((entry, index) => {
    const nextEntry = next[index]
    return entry.id === nextEntry.id &&
      entry.status === nextEntry.status &&
      entry.time === nextEntry.time &&
      entry.detail === nextEntry.detail
  })
}

export function useWorkspaceRuntimeData({
  activeContext,
  apiBase,
  enableConversationLogRefresh = false,
  enableConversationLogs = true,
  enableRunLogEntries = true,
  enableStageLogs = true,
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
    let controller: AbortController | null = null

    const loadProgress = () => {
      if (!activeContext.versionDir) {
        setProgressData(null)
        return
      }
      controller?.abort()
      controller = new AbortController()
      fetch(`${joinApiPath(apiBase, "/workspace/progress")}${buildWorkspaceQuery(activeContext, sessionId)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() as Promise<WorkspaceProgressResponse> : null)
        .then(data => {
          if (!cancelled) setProgressData(data)
        })
        .catch(err => {
          if (err instanceof DOMException && err.name === "AbortError") return
          if (!cancelled) setProgressData(null)
        })
    }

    loadProgress()
    const intervalId = window.setInterval(loadProgress, running ? 500 : 3000)
    return () => {
      cancelled = true
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, progressRefreshNonce, running, sessionId, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    const loadStageLogs = () => {
      if (!enableStageLogs || !activeContext.versionDir) {
        setStageLogs([])
        return
      }
      controller?.abort()
      controller = new AbortController()
      const query = appendQueryParams(buildWorkspaceQuery(activeContext), { limit: MAX_STAGE_LOG_ENTRIES })
      fetch(`${joinApiPath(apiBase, "/logs/stages")}${query}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() as Promise<StageLogEntry[]> : [])
        .then(data => {
          if (cancelled) return
          const nextLogs = Array.isArray(data) ? data.slice(-MAX_STAGE_LOG_ENTRIES) : []
          setStageLogs(previousLogs => haveSameLogEntries(previousLogs, nextLogs) ? previousLogs : nextLogs)
        })
        .catch(err => {
          if (err instanceof DOMException && err.name === "AbortError") return
          if (!cancelled) setStageLogs([])
        })
    }

    loadStageLogs()
    const intervalId = window.setInterval(loadStageLogs, 3000)
    return () => {
      cancelled = true
      controller?.abort()
      window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, enableStageLogs, workspaceRefreshNonce])

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    const loadConversationLogs = () => {
      if (!enableConversationLogs || !activeContext.versionDir) {
        setConversationLogs([])
        return
      }
      controller?.abort()
      controller = new AbortController()
      const query = appendQueryParams(buildWorkspaceQuery(activeContext), {
        eventLimit: CONVERSATION_EVENT_LIMIT,
        sessionLimit: CONVERSATION_SESSION_LIMIT,
        turnLimit: CONVERSATION_TURN_LIMIT,
      })
      fetch(`${joinApiPath(apiBase, "/logs/conversation")}${query}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() as Promise<ConversationLogEntry[]> : [])
        .then(data => {
          if (cancelled) return
          const nextLogs = Array.isArray(data) ? data.slice(-MAX_CONVERSATION_LOG_ENTRIES) : []
          setConversationLogs(previousLogs => haveSameLogEntries(previousLogs, nextLogs) ? previousLogs : nextLogs)
        })
        .catch(err => {
          if (err instanceof DOMException && err.name === "AbortError") return
          if (!cancelled) setConversationLogs([])
        })
    }

    loadConversationLogs()
    const intervalId = enableConversationLogRefresh ? window.setInterval(loadConversationLogs, 2000) : null
    return () => {
      cancelled = true
      controller?.abort()
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, apiBase, enableConversationLogRefresh, enableConversationLogs, workspaceRefreshNonce])

  const runLogEntries = useMemo(() => (
    enableRunLogEntries ? getRunLogEntries(visibleTurns, visibleCurrentEvents, t) : []
  ), [enableRunLogEntries, visibleCurrentEvents, t, visibleTurns])
  const logEntries = useMemo(() => getDisplayLogEntries(stageLogs, conversationLogs, runLogEntries), [conversationLogs, runLogEntries, stageLogs])
  const workflowLoopProgressEntries = useMemo(
    () => getWorkflowLoopProgressEntries(progressData?.data, t, progressVariant),
    [progressData, progressVariant, t],
  )

  return {
    conversationLogs,
    logEntries,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
  }
}

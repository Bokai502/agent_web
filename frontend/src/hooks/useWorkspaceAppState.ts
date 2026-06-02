import { useState, useRef, useEffect, useCallback } from "react"
import { joinApiPath } from "../app/apiBase"
import { useCodexStream } from "./useTaskStream"
import type { CodexInputItem, Session, ThreadEvent, Turn } from "../types"
import { shouldSuppressEvent } from "../utils/codexEventFilter"
import {
  apiLoad,
  findActiveSession,
  generateId,
  getPendingAskUser,
  getSessionIdFromPath,
  getTurns,
  updateBrowserPath,
} from "../app/sessionUtils"

interface WorkspaceAppStateOptions {
  apiBase?: string
  homePath?: string
}

export type SessionWorkspace = {
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  versionId?: string | null
}

function normalizeWorkspaceDir(workspaceDir?: string | null) {
  const normalized = workspaceDir?.trim().replace(/[\\/]+$/u, "")
  return normalized || null
}

function normalizeId(value?: string | null) {
  return value?.trim() || null
}

function isSameWorkspaceContext(session: Session | null | undefined, workspace: SessionWorkspace) {
  const workspaceId = normalizeId(workspace.workspaceId)
  const versionId = normalizeId(workspace.versionId)
  const workspaceDir = normalizeWorkspaceDir(workspace.workspaceDir)
  if (workspaceId && versionId) {
    return normalizeId(session?.workspaceId) === workspaceId && normalizeId(session?.versionId) === versionId
  }
  if (workspaceDir) return normalizeWorkspaceDir(session?.workspaceDir) === workspaceDir
  return false
}

function getInputPromptText(input: string | CodexInputItem[]) {
  if (typeof input === "string") return input
  const text = input
    .filter((item): item is Extract<CodexInputItem, { type: "text" }> => item.type === "text")
    .map(item => item.text)
    .join("\n\n")
    .trim()
  if (text) return text
  return input.map(item => item.type === "local_image" ? "[image]" : "").filter(Boolean).join(" ")
}

async function deleteSessionRequest(sessionId: string, apiBase?: string) {
  const deletePath = joinApiPath(apiBase, `/sessions/${encodeURIComponent(sessionId)}/delete`)
  const legacyDeletePath = joinApiPath(apiBase, `/sessions/${encodeURIComponent(sessionId)}`)
  const apiRequests = [
    { method: "POST", path: deletePath },
    { method: "DELETE", path: legacyDeletePath },
  ]
  const apiUrls = apiRequests.flatMap(request => {
    const urls = [{ ...request, url: request.path }]

    if (window.location.hostname && window.location.protocol === "http:") {
      urls.push({
        ...request,
        url: `http://${window.location.hostname}:${__BACKEND_PORT__}${request.path}`,
      })
    }

    return urls
  })

  let lastError: unknown = null

  for (const { method, url } of apiUrls) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          cache: "no-store",
        })
        if (response.ok) return
        lastError = new Error(`delete failed with status ${response.status}`)
        console.warn("[sessions] delete request failed", { attempt: attempt + 1, method, status: response.status, url })
      } catch (err) {
        lastError = err
        console.warn("[sessions] delete request errored", { attempt: attempt + 1, err, method, url })
      }

      if (attempt === 0) {
        await new Promise(resolve => window.setTimeout(resolve, 300))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("delete failed")
}

export function useWorkspaceAppState({ apiBase, homePath }: WorkspaceAppStateOptions = {}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => getSessionIdFromPath(window.location.pathname, homePath))
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [lastCompletedTurnId, setLastCompletedTurnId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1100)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const currentTurnIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const runningSessionIdRef = useRef<string | null>(null)
  const runningWorkspaceRef = useRef<SessionWorkspace | null>(null)
  const sessionsRef = useRef<Session[]>(sessions)

  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedSessionsRef = useRef(false)
  const sessionSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const deletedSessionIdsRef = useRef<Set<string>>(new Set())

  const { run, abort } = useCodexStream(apiBase)

  const reloadSessions = useCallback(async () => {
    const serverSessions = await apiLoad(apiBase)
    const deletedSessionIds = deletedSessionIdsRef.current
    const nextSessions = deletedSessionIds.size > 0
      ? serverSessions.filter(session => !deletedSessionIds.has(session.id))
      : serverSessions

    hasLoadedSessionsRef.current = true
    setSessions(nextSessions)
    setSessionsLoaded(true)
    return nextSessions
  }, [apiBase])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1100)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      const nextSessionId = getSessionIdFromPath(window.location.pathname, homePath)
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
      }

      setActiveSessionId(nextSessionId)
      activeSessionIdRef.current = nextSessionId
      setCurrentPrompt("")
      setCurrentEvents([])
      currentEventsRef.current = []
      currentTurnIdRef.current = null
      setLastCompletedTurnId(null)
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [homePath])

  useEffect(() => {
    updateBrowserPath(activeSessionId, !activeSessionId, homePath)
  }, [])

  useEffect(() => {
    if (runningSessionIdRef.current) return
    const nextSessionId = getSessionIdFromPath(window.location.pathname, homePath)
    setActiveSessionId(nextSessionId)
    activeSessionIdRef.current = nextSessionId
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
    currentPromptRef.current = ""
    currentTurnIdRef.current = null
    setLastCompletedTurnId(null)
  }, [apiBase, homePath])

  useEffect(() => {
    reloadSessions().catch(() => {
      hasLoadedSessionsRef.current = true
      setSessionsLoaded(true)
    })
  }, [reloadSessions])

  useEffect(() => {
    const reloadIfIdle = () => {
      if (runningSessionIdRef.current) return
      reloadSessions().catch(() => {})
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reloadIfIdle()
    }

    window.addEventListener("focus", reloadIfIdle)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("focus", reloadIfIdle)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [reloadSessions])

  const saveSession = useCallback((session: Session, immediate = false) => {
    if (!hasLoadedSessionsRef.current) return
    if (deletedSessionIdsRef.current.has(session.id)) return
    const timers = sessionSaveTimersRef.current
    const existingTimer = timers.get(session.id)
    if (existingTimer) clearTimeout(existingTimer)

    const write = () => {
      timers.delete(session.id)
      fetch(joinApiPath(apiBase, `/sessions/${encodeURIComponent(session.id)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      }).catch(() => {
        // ignore network errors
      })
    }

    if (immediate) {
      write()
      return
    }

    timers.set(session.id, setTimeout(write, 300))
  }, [apiBase])

  const deleteSession = useCallback((sessionId: string) => {
    deletedSessionIdsRef.current.add(sessionId)
    const existingTimer = sessionSaveTimersRef.current.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      sessionSaveTimersRef.current.delete(sessionId)
    }
    return deleteSessionRequest(sessionId, apiBase)
  }, [apiBase])

  const activeSession = findActiveSession(sessions, activeSessionId)
  const turns: Turn[] = getTurns(activeSession)
  const pendingAskUser = getPendingAskUser(activeSession)

  const resetLiveTurn = useCallback(() => {
    setCurrentPrompt("")
    setCurrentEvents([])
    currentEventsRef.current = []
    currentTurnIdRef.current = null
  }, [])

  const handleNew = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    setLastCompletedTurnId(null)
    updateBrowserPath(null, false, homePath)
    if (!runningSessionIdRef.current) resetLiveTurn()
  }, [homePath, resetLiveTurn])

  const handleClearActiveSession = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    if (activeSessionIdRef.current !== null) {
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      setLastCompletedTurnId(null)
      updateBrowserPath(null, false, homePath)
    }
    if (!runningSessionIdRef.current) resetLiveTurn()
  }, [homePath, resetLiveTurn])

  const handleSelect = useCallback((id: string) => {
    if (running) return
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    setLastCompletedTurnId(null)
    updateBrowserPath(id, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn, running])

  const handleSelectWorkspaceSession = useCallback((workspace: SessionWorkspace) => {
    const workspaceDir = normalizeWorkspaceDir(workspace.workspaceDir)
    const workspaceId = normalizeId(workspace.workspaceId)
    const versionId = normalizeId(workspace.versionId)
    if (!workspaceDir && (!workspaceId || !versionId)) return

    const activeSession = sessions.find(session => session.id === activeSessionId) ?? null
    if (isSameWorkspaceContext(activeSession, workspace)) return

    const matchingSession = [...sessions]
      .filter(session => {
        if (workspaceDir && normalizeWorkspaceDir(session.workspaceDir) === workspaceDir) return true
        if (workspaceId && versionId) {
          return normalizeId(session.workspaceId) === workspaceId && normalizeId(session.versionId) === versionId
        }
        return false
      })
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null

    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }

    const nextSessionId = matchingSession?.id ?? null
    setActiveSessionId(nextSessionId)
    activeSessionIdRef.current = nextSessionId
    setLastCompletedTurnId(null)
    updateBrowserPath(nextSessionId, false, homePath)
    if (!runningSessionIdRef.current) resetLiveTurn()
  }, [activeSessionId, homePath, resetLiveTurn, sessions])

  const handleAssignSessionWorkspace = useCallback((id: string, workspace: SessionWorkspace) => {
    setSessions(prev => prev.map(session => {
      if (session.id !== id) return session
      const nextSession = {
        ...session,
        workspaceId: workspace.workspaceId ?? session.workspaceId ?? null,
        versionId: workspace.versionId ?? session.versionId ?? null,
        workspaceDir: workspace.workspaceDir ?? session.workspaceDir ?? null,
        workspaceName: workspace.workspaceName ?? session.workspaceName ?? null,
      }
      saveSession(nextSession, true)
      return nextSession
    }))
  }, [saveSession])

  const handleDelete = useCallback(async (id: string) => {
    if (id === activeSessionIdRef.current && running) {
      abort(id)
    }

    const previousSessions = sessionsRef.current
    setSessions(prev => prev.filter(session => session.id !== id))

    if (activeSessionIdRef.current === id) {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
        batchTimerRef.current = null
      }
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      setLastCompletedTurnId(null)
      updateBrowserPath(null, false, homePath)
      resetLiveTurn()
    }

    try {
      await deleteSession(id)
    } catch (err) {
      deletedSessionIdsRef.current.delete(id)
      setSessions(previousSessions)
      throw err
    }
  }, [abort, deleteSession, homePath, resetLiveTurn, running])

  const handleStopAskUser = useCallback(() => {
    const sid = activeSessionIdRef.current
    if (!sid || !pendingAskUser) return
    setSessions(prev =>
      prev.map(session => {
        if (session.id !== sid) return session
        const nextSession = { ...session, dismissedAskUserId: pendingAskUser.id }
        saveSession(nextSession)
        return nextSession
      })
    )
  }, [pendingAskUser, saveSession])

  const handleSubmit = useCallback((input: string | CodexInputItem[], enabledSkills: string[] = [], workspace?: SessionWorkspace) => {
    const prompt = getInputPromptText(input)
    const workspaceDir = normalizeWorkspaceDir(workspace?.workspaceDir)
    const workspaceId = normalizeId(workspace?.workspaceId)
    const versionId = normalizeId(workspace?.versionId)
    const workspaceForRun: SessionWorkspace = {
      workspaceDir,
      workspaceId,
      workspaceName: workspace?.workspaceName ?? null,
      versionId,
    }
    let sid = activeSessionIdRef.current
    let threadIdForRun: string | null = null
    const turnIdForRun = generateId()
    const activeSession = sid ? sessions.find(session => session.id === sid) ?? null : null

    if (sid && workspace && !isSameWorkspaceContext(activeSession, workspace) && (workspaceDir || (workspaceId && versionId))) {
      sid = null
      activeSessionIdRef.current = null
    }

    if (!sid) {
      const newSession: Session = {
        id: generateId(),
        title: prompt.slice(0, 60),
        threadId: null,
        turns: [],
        createdAt: Date.now(),
        dismissedAskUserId: null,
        workspaceId,
        versionId,
        workspaceDir,
        workspaceName: workspace?.workspaceName ?? null,
      }
      setSessions(prev => [...prev, newSession])
      saveSession(newSession, true)
      setActiveSessionId(newSession.id)
      activeSessionIdRef.current = newSession.id
      updateBrowserPath(newSession.id, false, homePath)
      sid = newSession.id
    } else {
      threadIdForRun = activeSession?.threadId ?? null
      updateBrowserPath(sid, true, homePath)
    }

    setSessions(prev => prev.map(session => {
      if (session.id !== sid) return session
      const nextSession = {
        ...session,
        dismissedAskUserId: null,
        workspaceId: workspaceId ?? session.workspaceId ?? null,
        versionId: versionId ?? session.versionId ?? null,
        workspaceDir: workspaceDir ?? session.workspaceDir ?? null,
        workspaceName: workspace?.workspaceName ?? session.workspaceName ?? null,
      }
      saveSession(nextSession)
      return nextSession
    }))
    setCurrentPrompt(prompt)
    setCurrentEvents([])
    setLastCompletedTurnId(null)
    currentEventsRef.current = []
    currentPromptRef.current = prompt
    currentTurnIdRef.current = turnIdForRun
    runningSessionIdRef.current = sid
    runningWorkspaceRef.current = workspaceForRun
    setRunning(true)
    let runEvents: ThreadEvent[] = []
    let livePersistTimer: ReturnType<typeof setTimeout> | null = null
    let lastPersistedEventCount = 0

    const persistLiveTurn = (immediate = false) => {
      const write = () => {
        livePersistTimer = null
        if (runEvents.length === lastPersistedEventCount && !immediate) return
        const session = sessionsRef.current.find(item => item.id === sid)
        if (!session) return
        const liveTurn: Turn = {
          id: turnIdForRun,
          userPrompt: prompt,
          events: runEvents,
        }
        const turns = session.turns.some(turn => turn.id === turnIdForRun)
          ? session.turns.map(turn => turn.id === turnIdForRun ? liveTurn : turn)
          : [...session.turns, liveTurn]
        saveSession({ ...session, turns }, true)
        lastPersistedEventCount = runEvents.length
      }

      if (immediate) {
        if (livePersistTimer) {
          clearTimeout(livePersistTimer)
          livePersistTimer = null
        }
        write()
        return
      }

      if (!livePersistTimer) {
        livePersistTimer = setTimeout(write, 1000)
      }
    }

    run(
      input,
      sid,
      threadIdForRun,
      turnIdForRun,
      enabledSkills,
      workspaceForRun,
      event => {
        if (shouldSuppressEvent(event)) return

        if (event.type === "thread.started") {
          const tid = event.thread_id ?? null
          if (tid) {
            setSessions(prev =>
              prev.map(session => {
                if (session.id !== sid) return session
                const nextSession = { ...session, threadId: tid }
                saveSession(nextSession)
                return nextSession
              })
            )
          }
        }

        runEvents = [...runEvents, event]
        if (runningSessionIdRef.current === sid) {
          currentEventsRef.current = runEvents
        }
        persistLiveTurn()

        if (
          event.type === "turn.completed" ||
          event.type === "turn.failed" ||
          event.type === "error"
        ) {
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current)
            batchTimerRef.current = null
          }
          if (runningSessionIdRef.current === sid) setCurrentEvents(runEvents)
        } else if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null
            if (runningSessionIdRef.current === sid) setCurrentEvents(runEvents)
          }, 80)
        }
      },
      () => {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current)
          batchTimerRef.current = null
        }
        if (livePersistTimer) {
          clearTimeout(livePersistTimer)
          livePersistTimer = null
        }

        const completedTurn: Turn = {
          id: turnIdForRun,
          userPrompt: prompt,
          events: runEvents,
        }
        const completedThreadId = runEvents.find(event => event.type === "thread.started")?.thread_id ?? threadIdForRun

        setSessions(prev => {
          let foundSession = false
          const nextSessions = prev.map(session => {
            if (session.id !== sid) return session
            foundSession = true
            const turns = session.turns.some(turn => turn.id === turnIdForRun)
              ? session.turns.map(turn => turn.id === turnIdForRun ? completedTurn : turn)
              : [...session.turns, completedTurn]
            const nextSession = {
              ...session,
              threadId: completedThreadId,
              turns,
              workspaceId: workspaceId ?? session.workspaceId ?? null,
              versionId: versionId ?? session.versionId ?? null,
              workspaceDir: workspaceDir ?? session.workspaceDir ?? null,
              workspaceName: workspace?.workspaceName ?? session.workspaceName ?? null,
            }
            saveSession(nextSession, true)
            return nextSession
          })

          if (foundSession) return nextSessions

          const restoredSession: Session = {
            id: sid,
            title: prompt.slice(0, 60),
            threadId: completedThreadId,
            turns: [completedTurn],
            createdAt: Date.now(),
            dismissedAskUserId: null,
            workspaceId,
            versionId,
            workspaceDir,
            workspaceName: workspace?.workspaceName ?? null,
          }
          saveSession(restoredSession, true)
          return [...nextSessions, restoredSession]
        })

        if (runningSessionIdRef.current === sid) {
          setActiveSessionId(sid)
          activeSessionIdRef.current = sid
          setLastCompletedTurnId(turnIdForRun)
          resetLiveTurn()
          runningSessionIdRef.current = null
          runningWorkspaceRef.current = null
          setRunning(false)
        }
      }
    )
  }, [homePath, resetLiveTurn, run, saveSession, sessions])

  const sortedSessions = [...sessions].sort((a, b) => b.createdAt - a.createdAt)
  return {
    activeSessionId,
    currentEvents,
    currentPrompt,
    currentTurnId: currentTurnIdRef.current,
    handleDelete,
    handleClearActiveSession,
    handleNew,
    handleSelect,
    handleSelectWorkspaceSession,
    handleAssignSessionWorkspace,
    handleStopAskUser,
    handleSubmit,
    isMobile,
    pendingAskUser,
    lastCompletedTurnId,
    running,
    runningSessionId: runningSessionIdRef.current,
    runningWorkspace: runningWorkspaceRef.current,
    reloadSessions,
    sessionsLoaded,
    sortedSessions,
    turns,
    abort,
  }
}

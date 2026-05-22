import { useState, useRef, useEffect, useCallback } from "react"
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
  homePath?: string
}

export type SessionWorkspace = {
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  versionId?: string | null
}

function normalizeWorkspaceDir(workspaceDir?: string | null) {
  return workspaceDir?.trim() || null
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

async function deleteSessionRequest(sessionId: string) {
  const deletePath = `/api/sessions/${encodeURIComponent(sessionId)}/delete`
  const legacyDeletePath = `/api/sessions/${encodeURIComponent(sessionId)}`
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

export function useWorkspaceAppState({ homePath }: WorkspaceAppStateOptions = {}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => getSessionIdFromPath(window.location.pathname, homePath))
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [running, setRunning] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1100)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const currentTurnIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<Session[]>(sessions)

  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedSessionsRef = useRef(false)
  const sessionSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const deletedSessionIdsRef = useRef<Set<string>>(new Set())

  const { run, abort } = useCodexStream()

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
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [homePath])

  useEffect(() => {
    updateBrowserPath(activeSessionId, !activeSessionId, homePath)
  }, [])

  useEffect(() => {
    apiLoad()
      .then(serverSessions => {
        hasLoadedSessionsRef.current = true
        setSessions(serverSessions)
      })
      .finally(() => {
        hasLoadedSessionsRef.current = true
        setSessionsLoaded(true)
      })
  }, [])

  const saveSession = useCallback((session: Session, immediate = false) => {
    if (!hasLoadedSessionsRef.current) return
    if (deletedSessionIdsRef.current.has(session.id)) return
    const timers = sessionSaveTimersRef.current
    const existingTimer = timers.get(session.id)
    if (existingTimer) clearTimeout(existingTimer)

    const write = () => {
      timers.delete(session.id)
      fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
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
  }, [])

  const deleteSession = useCallback((sessionId: string) => {
    deletedSessionIdsRef.current.add(sessionId)
    const existingTimer = sessionSaveTimersRef.current.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      sessionSaveTimersRef.current.delete(sessionId)
    }
    return deleteSessionRequest(sessionId)
  }, [])

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
    updateBrowserPath(null, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn])

  const handleSelect = useCallback((id: string) => {
    if (running) return
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setActiveSessionId(id)
    activeSessionIdRef.current = id
    updateBrowserPath(id, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn, running])

  const handleSelectWorkspaceSession = useCallback((workspace: SessionWorkspace) => {
    if (running) return

    const workspaceDir = normalizeWorkspaceDir(workspace.workspaceDir)
    const workspaceId = normalizeId(workspace.workspaceId)
    const versionId = normalizeId(workspace.versionId)
    if (!workspaceDir && (!workspaceId || !versionId)) return

    const activeSession = sessionsRef.current.find(session => session.id === activeSessionIdRef.current) ?? null
    if (isSameWorkspaceContext(activeSession, workspace)) return

    const matchingSession = [...sessionsRef.current]
      .filter(session => {
        if (workspaceId && versionId) {
          return normalizeId(session.workspaceId) === workspaceId && normalizeId(session.versionId) === versionId
        }
        return normalizeWorkspaceDir(session.workspaceDir) === workspaceDir
      })
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null

    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }

    const nextSessionId = matchingSession?.id ?? null
    setActiveSessionId(nextSessionId)
    activeSessionIdRef.current = nextSessionId
    updateBrowserPath(nextSessionId, false, homePath)
    resetLiveTurn()
  }, [homePath, resetLiveTurn, running])

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
      abort()
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
    currentEventsRef.current = []
    currentPromptRef.current = prompt
    currentTurnIdRef.current = turnIdForRun
    setRunning(true)

    run(
      input,
      sid,
      threadIdForRun,
      turnIdForRun,
      enabledSkills,
      {
        workspaceDir,
        workspaceId,
        workspaceName: workspace?.workspaceName ?? null,
        versionId,
      },
      event => {
        if (shouldSuppressEvent(event)) return

        if (event.type === "thread.started") {
          const tid = event.thread_id ?? null
          if (tid) {
            setSessions(prev =>
              prev.map(session => {
                if (session.id !== activeSessionIdRef.current) return session
                const nextSession = { ...session, threadId: tid }
                saveSession(nextSession)
                return nextSession
              })
            )
          }
        }

        currentEventsRef.current = [...currentEventsRef.current, event]

        if (
          event.type === "turn.completed" ||
          event.type === "turn.failed" ||
          event.type === "error"
        ) {
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current)
            batchTimerRef.current = null
          }
          setCurrentEvents([...currentEventsRef.current])
        } else if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null
            setCurrentEvents([...currentEventsRef.current])
          }, 80)
        }
      },
      () => {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current)
          batchTimerRef.current = null
        }

        const completedTurn: Turn = {
          id: currentTurnIdRef.current ?? generateId(),
          userPrompt: currentPromptRef.current,
          events: currentEventsRef.current,
        }

        setSessions(prev =>
          prev.map(session => {
            if (session.id !== activeSessionIdRef.current) return session
            const nextSession = { ...session, turns: [...session.turns, completedTurn] }
            saveSession(nextSession, true)
            return nextSession
          })
        )

        resetLiveTurn()
        setRunning(false)
      }
    )
  }, [homePath, resetLiveTurn, run, saveSession, sessions])

  const sortedSessions = [...sessions].sort((a, b) => b.createdAt - a.createdAt)
  return {
    activeSessionId,
    currentEvents,
    currentPrompt,
    handleDelete,
    handleNew,
    handleSelect,
    handleSelectWorkspaceSession,
    handleAssignSessionWorkspace,
    handleStopAskUser,
    handleSubmit,
    isMobile,
    pendingAskUser,
    running,
    sessionsLoaded,
    sortedSessions,
    turns,
    abort,
  }
}

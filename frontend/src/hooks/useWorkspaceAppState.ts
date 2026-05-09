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
  workspaceName?: string | null
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

export function useWorkspaceAppState({ homePath }: WorkspaceAppStateOptions = {}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => getSessionIdFromPath(window.location.pathname, homePath))
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [currentEvents, setCurrentEvents] = useState<ThreadEvent[]>([])
  const [running, setRunning] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1100)
  const currentEventsRef = useRef<ThreadEvent[]>([])
  const currentPromptRef = useRef("")
  const currentTurnIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<Session[]>(sessions)

  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedSessionsRef = useRef(false)
  const sessionSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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
    apiLoad().then(serverSessions => {
      hasLoadedSessionsRef.current = true
      setSessions(serverSessions)
    })
  }, [])

  const saveSession = useCallback((session: Session, immediate = false) => {
    if (!hasLoadedSessionsRef.current) return
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
    const existingTimer = sessionSaveTimersRef.current.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      sessionSaveTimersRef.current.delete(sessionId)
    }
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => {
      // ignore network errors
    })
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

  const handleAssignSessionWorkspace = useCallback((id: string, workspace: SessionWorkspace) => {
    setSessions(prev => prev.map(session => {
      if (session.id !== id) return session
      const nextSession = {
        ...session,
        workspaceDir: workspace.workspaceDir ?? session.workspaceDir ?? null,
        workspaceName: workspace.workspaceName ?? session.workspaceName ?? null,
      }
      saveSession(nextSession, true)
      return nextSession
    }))
  }, [saveSession])

  const handleDelete = useCallback((id: string) => {
    if (id === activeSessionIdRef.current && running) {
      abort()
    }

    setSessions(prev => prev.filter(session => session.id !== id))
    deleteSession(id)

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
    let sid = activeSessionIdRef.current
    let threadIdForRun: string | null = null
    const turnIdForRun = generateId()

    if (!sid) {
      const newSession: Session = {
        id: generateId(),
        title: prompt.slice(0, 60),
        threadId: null,
        turns: [],
        createdAt: Date.now(),
        dismissedAskUserId: null,
        workspaceDir: workspace?.workspaceDir ?? null,
        workspaceName: workspace?.workspaceName ?? null,
      }
      setSessions(prev => [...prev, newSession])
      saveSession(newSession, true)
      setActiveSessionId(newSession.id)
      activeSessionIdRef.current = newSession.id
      updateBrowserPath(newSession.id, false, homePath)
      sid = newSession.id
    } else {
      threadIdForRun = sessions.find(session => session.id === sid)?.threadId ?? null
      updateBrowserPath(sid, true, homePath)
    }

    setSessions(prev => prev.map(session => {
      if (session.id !== sid) return session
      const nextSession = {
        ...session,
        dismissedAskUserId: null,
        workspaceDir: session.workspaceDir ?? workspace?.workspaceDir ?? null,
        workspaceName: session.workspaceName ?? workspace?.workspaceName ?? null,
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
    handleAssignSessionWorkspace,
    handleStopAskUser,
    handleSubmit,
    isMobile,
    pendingAskUser,
    running,
    sortedSessions,
    turns,
    abort,
  }
}

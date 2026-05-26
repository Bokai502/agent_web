import type { AskUserItem, Session, Turn } from "../types"
import { joinApiPath } from "./apiBase"
import { HOME_PATH } from "./workspaceConfig"

export const APP_NAVIGATION_EVENT = "codex:navigation"

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function getPendingAskUser(session: Session | null): AskUserItem | null {
  const lastTurn = session?.turns[session.turns.length - 1]
  if (!lastTurn) return null

  for (let i = lastTurn.events.length - 1; i >= 0; i--) {
    const event = lastTurn.events[i]
    if (event.type === "item.completed" && event.item.type === "ask_user") {
      return session?.dismissedAskUserId === event.item.id ? null : event.item
    }
  }

  return null
}

export async function apiLoad(apiBase?: string): Promise<Session[]> {
  try {
    const res = await fetch(joinApiPath(apiBase, "/sessions"))
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? (data as Session[]) : []
  } catch {
    return []
  }
}

export function formatSessionTime(createdAt: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt))
}

export function getSessionIdFromPath(pathname: string, homePath = HOME_PATH): string | null {
  if (pathname === HOME_PATH || pathname === homePath) return null
  if (pathname.startsWith(`${homePath}/`)) {
    const nested = pathname.slice(homePath.length + 1).trim()
    return nested.length > 0 ? decodeURIComponent(nested) : null
  }
  return null
}

export function updateBrowserPath(sessionId: string | null, replace = false, homePath = HOME_PATH) {
  const nextPath = sessionId
    ? `${homePath}/${encodeURIComponent(sessionId)}`
    : homePath
  const currentPath = window.location.pathname
  if (currentPath === nextPath) return

  const method = replace ? "replaceState" : "pushState"
  window.history[method](null, "", nextPath)
  if (nextPath === homePath || nextPath === HOME_PATH) {
    window.dispatchEvent(new Event(APP_NAVIGATION_EVENT))
  }
}

export function findActiveSession(sessions: Session[], activeSessionId: string | null) {
  return sessions.find(session => session.id === activeSessionId) ?? null
}

export function getTurns(session: Session | null): Turn[] {
  return session?.turns ?? []
}

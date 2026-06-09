import { afterEach, describe, expect, it, vi } from "vitest"
import {
  APP_NAVIGATION_EVENT,
  findActiveSession,
  getPendingAskUser,
  getSessionIdFromPath,
  getTurns,
  updateBrowserPath,
} from "../../src/app/sessionUtils"
import type { Session } from "../../src/types"

const session: Session = {
  createdAt: 100,
  dismissedAskUserId: null,
  id: "session-1",
  threadId: null,
  title: "Session",
  turns: [
    {
      events: [
        { type: "item.completed", item: { id: "ask-1", type: "ask_user", question: "Continue?", options: ["yes"] } },
      ],
      id: "turn-1",
      userPrompt: "hello",
    },
  ],
}

describe("sessionUtils", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("finds the pending ask_user item unless it has been dismissed", () => {
    expect(getPendingAskUser(session)?.id).toBe("ask-1")
    expect(getPendingAskUser({ ...session, dismissedAskUserId: "ask-1" })).toBeNull()
  })

  it("extracts encoded session IDs from workspace paths", () => {
    expect(getSessionIdFromPath("/workspace")).toBeNull()
    expect(getSessionIdFromPath("/workspace/session%201")).toBe("session 1")
    expect(getSessionIdFromPath("/agent/session-2", "/agent")).toBe("session-2")
  })

  it("updates browser path and emits navigation events for home navigation", () => {
    window.history.replaceState(null, "", "/workspace/session-1")
    const listener = vi.fn()
    window.addEventListener(APP_NAVIGATION_EVENT, listener)

    updateBrowserPath(null, false, "/workspace")

    expect(window.location.pathname).toBe("/workspace")
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(APP_NAVIGATION_EVENT, listener)
  })

  it("finds active sessions and returns turns", () => {
    expect(findActiveSession([session], "session-1")).toBe(session)
    expect(findActiveSession([session], "missing")).toBeNull()
    expect(getTurns(session)).toHaveLength(1)
    expect(getTurns(null)).toEqual([])
  })
})

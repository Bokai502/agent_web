import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWorkspaceAppState } from "./useWorkspaceAppState"
import type { Session } from "../types"

vi.mock("./useTaskStream", () => ({
  useCodexStream: () => ({
    abort: vi.fn(),
    run: vi.fn(),
  }),
}))

const sessions: Session[] = [
  {
    id: "older",
    title: "旧会话",
    threadId: null,
    turns: [],
    createdAt: 100,
    dismissedAskUserId: null,
    workspaceDir: "/data/lbk/codex_web/data/input_data/workspaces/ws_v10_data/versions/v0001",
    workspaceId: "ws_v10_data",
    workspaceName: "v10_data",
    versionId: "v0001",
  },
  {
    id: "latest",
    title: "最新会话",
    threadId: null,
    turns: [{
      id: "turn-1",
      userPrompt: "组装卫星",
      events: [],
    }],
    createdAt: 200,
    dismissedAskUserId: null,
    workspaceDir: "/data/lbk/codex_web/data/input_data/workspaces/ws_v10_data/versions/v0001",
    workspaceId: "ws_v10_data",
    workspaceName: "v10_data",
    versionId: "v0001",
  },
]

describe("useWorkspaceAppState", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/workspace")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/sessions")) {
        return new Response(JSON.stringify(sessions), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      return new Response(null, { status: 204 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("selects the latest session for the active workspace after sessions load", async () => {
    const { result } = renderHook(() => useWorkspaceAppState({ homePath: "/workspace" }))

    await waitFor(() => expect(result.current.sessionsLoaded).toBe(true))

    act(() => {
      result.current.handleSelectWorkspaceSession({
        workspaceDir: "/data/lbk/codex_web/data/input_data/workspaces/ws_v10_data/versions/v0001",
        workspaceId: "ws_v10_data",
        workspaceName: "v10_data",
        versionId: "v0001",
      })
    })

    expect(result.current.activeSessionId).toBe("latest")
    expect(result.current.turns).toHaveLength(1)
    expect(window.location.pathname).toBe("/workspace/latest")
  })
})

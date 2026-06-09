import React from "react"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import WorkspaceHomePage from "../../src/pages/WorkspaceHomePage"
import WorkspaceSessionPage from "../../src/pages/WorkspaceSessionPage"

describe("front-end redesign targets", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/workspace")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/remote-tools/ensure-desktops")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      if (url.endsWith("/api/sessions") || url.endsWith("/sessions")) {
        return new Response(JSON.stringify([]), {
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

  it("renders the Apple-style workspace for real sessions", () => {
    window.history.replaceState(null, "", "/workspace/test-session")
    render(<WorkspaceSessionPage homePath="/workspace" />)

    expect(screen.getByRole("button", { name: "返回主页" })).toBeInTheDocument()
    expect(screen.getByText("结果预览")).toBeInTheDocument()
    expect(screen.getByText("组件清单")).toBeInTheDocument()
    expect(screen.queryByText("第一个对话")).not.toBeInTheDocument()
  })

  it("renders the new Apple-style home interface", () => {
    render(<WorkspaceHomePage homePath="/workspace" />)

    expect(screen.getByRole("button", { name: "返回 Home 页面" })).toBeInTheDocument()
    expect(screen.getByText("把想法变成可查看、可复用的结构方案。")).toBeInTheDocument()
    expect(screen.getByText("最近的历史对话")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送任务" })).toBeInTheDocument()
    expect(screen.queryByText("Past Conversations")).not.toBeInTheDocument()
  })
})

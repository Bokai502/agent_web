import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import WorkspaceHomePage from "../pages/WorkspaceHomePage"
import WorkspaceSessionPage from "../pages/WorkspaceSessionPage"

describe("front-end redesign targets", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/workspace")
  })

  it("renders the Apple-style workspace for real sessions", () => {
    window.history.replaceState(null, "", "/workspace/test-session")
    render(<WorkspaceSessionPage homePath="/workspace" />)

    expect(screen.getByText("工作台首页")).toBeInTheDocument()
    expect(screen.getByText("3D 模型预览")).toBeInTheDocument()
    expect(screen.getByText("BOM List")).toBeInTheDocument()
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

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OutputLog } from "./OutputLog"

describe("OutputLog markdown rendering", () => {
  it("renders agent messages as markdown while leaving the current user prompt as plain text", () => {
    render(
      <OutputLog
        turns={[]}
        currentPrompt="# plain user"
        currentEvents={[
          {
            type: "item.completed",
            item: {
              id: "agent-1",
              type: "agent_message",
              text: ["# Agent heading", "", "- bullet"].join("\n"),
            },
          },
        ]}
        running={false}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    expect(screen.getByRole("heading", { level: 1, name: "Agent heading" })).toBeInTheDocument()
    expect(screen.getByText("# plain user")).toBeInTheDocument()
    expect(screen.getAllByRole("list")).toHaveLength(1)
  })

  it("renders live reasoning content as markdown", () => {
    const { container } = render(
      <OutputLog
        turns={[]}
        currentPrompt=""
        currentEvents={[
          {
            type: "item.started",
            item: {
              id: "reason-1",
              type: "reasoning",
              text: ["> note", "", "1. first"].join("\n"),
            },
          },
        ]}
        running={true}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    expect(container.querySelector("blockquote")).not.toBeNull()
    expect(screen.getByRole("list")).toHaveTextContent("first")
  })

  it("renders reconnect errors", () => {
    render(
      <OutputLog
        turns={[]}
        currentPrompt=""
        currentEvents={[
          {
            type: "error",
            message: "Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)",
          },
        ]}
        running={false}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    expect(screen.getByText(/Reconnecting/i)).toBeInTheDocument()
  })

  it("renders only the first command line by default and expands the rest on click", () => {
    render(
      <OutputLog
        turns={[]}
        currentPrompt=""
        currentEvents={[
          {
            type: "item.completed",
            item: {
              id: "cmd-1",
              type: "command_execution",
              command: ["/bin/bash -lc 'freecad-create-assembly --input", "/tmp/open-codex-web/data/sample.yaml --doc-name", "SampleYamlAssembly'"].join("\n"),
              aggregated_output: "freecad-get-view",
              exit_code: 0,
              status: "completed",
            },
          },
        ]}
        running={false}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    const summaryLine = screen.getByText("/bin/bash -lc 'freecad-create-assembly --input")
    expect(summaryLine).toHaveStyle({
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      color: "var(--code-text)",
    })
    expect(screen.queryByText("/tmp/open-codex-web/data/sample.yaml --doc-name")).not.toBeInTheDocument()
    expect(summaryLine.closest("div")).toHaveStyle({
      background: "var(--code-bg)",
      border: "1px solid var(--border)",
    })

    fireEvent.click(screen.getByRole("button"))

    expect(screen.getByText(/\/tmp\/open-codex-web\/data\/sample\.yaml --doc-name\s+SampleYamlAssembly'/)).toBeInTheDocument()
    expect(screen.getByText("freecad-get-view")).toBeInTheDocument()
  })
})

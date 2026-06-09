import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MarkdownText } from "../../src/components/outputMarkdown"

describe("MarkdownText", () => {
  it("renders GFM markdown and local image paths", () => {
    render(
      <MarkdownText
        text={[
          "# Title",
          "",
          "- first",
          "- second",
          "",
          "```ts",
          'console.log("hi")',
          "```",
          "",
          "| a | b |",
          "| - | - |",
          "| 1 | 2 |",
          "",
          "C:\\tmp\\plot.png",
        ].join("\n")}
      />
    )

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument()
    expect(screen.getByRole("list")).toHaveTextContent("first")
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "C:\\tmp\\plot.png" })).toHaveAttribute(
      "src",
      "/api/image?path=C%3A%5Ctmp%5Cplot.png"
    )
  })

  it("does not turn raw html into DOM nodes", () => {
    const { container } = render(
      <MarkdownText text={["<script>alert('x')</script>", "", "safe"].join("\n")} />
    )

    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText("safe")).toBeInTheDocument()
  })

  it("uses a lighter background for inline code than fenced code blocks", () => {
    render(<MarkdownText text={"Use `one` here.\n\n```ts\nconst one = 1\n```"} />)

    expect(screen.getByText("one").closest("code")).toHaveStyle({
      background: "rgba(15, 23, 42, 0.08)",
    })
    expect(screen.getByText("const one = 1").closest("code")).not.toHaveStyle({
      background: "rgba(15, 23, 42, 0.08)",
    })
  })
})

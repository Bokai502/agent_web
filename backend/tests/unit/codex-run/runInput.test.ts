import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getInputTextLength, normalizeRunInput, summarizeInput } from "../../../src/codex-run/runInput.js"

describe("runInput", () => {
  it("normalizes mixed SDK input arrays and drops invalid items", () => {
    const input = normalizeRunInput([
      { type: "text", text: "  hello  " },
      { type: "local_image", path: " /tmp/a.png " },
      { type: "text", text: " " },
      { type: "local_image", path: "" },
      { type: "unknown", text: "ignored" },
    ], null)

    assert.deepEqual(input, [
      { type: "text", text: "hello" },
      { type: "local_image", path: "/tmp/a.png" },
    ])
  })

  it("falls back to prompt text when input is not an array", () => {
    assert.deepEqual(normalizeRunInput(null, "  prompt text  "), [
      { type: "text", text: "prompt text" },
    ])
  })

  it("summarizes text and image input", () => {
    const input = [
      { type: "text" as const, text: "abc" },
      { type: "local_image" as const, path: "/tmp/a.png" },
      { type: "text" as const, text: "de" },
    ]

    assert.equal(getInputTextLength(input), 5)
    assert.deepEqual(summarizeInput(input), {
      itemCount: 3,
      localImageItemCount: 1,
      textChars: 5,
      textItemCount: 2,
    })
  })
})

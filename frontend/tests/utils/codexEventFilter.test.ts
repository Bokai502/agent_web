import { describe, expect, it } from "vitest"
import { getEventErrorMessage, shouldSuppressEvent } from "../../src/utils/codexEventFilter"

describe("codexEventFilter", () => {
  it("extracts error messages from failed event shapes", () => {
    expect(getEventErrorMessage({ type: "turn.failed", error: { message: "turn failed" } })).toBe("turn failed")
    expect(getEventErrorMessage({ type: "thread_error", error: { message: "thread failed" } })).toBe("thread failed")
    expect(getEventErrorMessage({ type: "error", message: "plain error" })).toBe("plain error")
  })

  it("returns null for non-error events and keeps events visible", () => {
    const event = { type: "turn.started" } as const

    expect(getEventErrorMessage(event)).toBeNull()
    expect(shouldSuppressEvent(event)).toBe(false)
  })
})

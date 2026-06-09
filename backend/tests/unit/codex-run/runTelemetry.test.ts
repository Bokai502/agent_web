import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  hasPersistableTerminalEvent,
  summarizeCodexEvent,
} from "../../../src/codex-run/runTelemetry.js"

describe("runTelemetry", () => {
  it("summarizes non-object and object Codex events", () => {
    assert.deepEqual(summarizeCodexEvent(null), { eventType: "object" })
    assert.deepEqual(summarizeCodexEvent("hello"), { eventType: "string" })

    const summary = summarizeCodexEvent({
      item: {
        command: "x".repeat(190),
        exit_code: 2,
        id: "item-1",
        status: "failed",
        text: "assistant text",
        type: "command_execution",
      },
      thread_id: "thread-1",
      type: "item.completed",
    })

    assert.equal(summary.eventType, "item.completed")
    assert.equal(summary.threadId, "thread-1")
    assert.equal(summary.itemId, "item-1")
    assert.equal(summary.itemType, "command_execution")
    assert.equal(summary.itemStatus, "failed")
    assert.equal(summary.exitCode, 2)
    assert.equal(summary.command, `${"x".repeat(177)}...`)
    assert.equal(summary.textLength, 14)
  })

  it("detects terminal events worth persisting", () => {
    assert.equal(hasPersistableTerminalEvent([]), false)
    assert.equal(hasPersistableTerminalEvent([{ type: "item.completed" }]), false)
    assert.equal(hasPersistableTerminalEvent([{ type: "turn.completed" }]), true)
    assert.equal(hasPersistableTerminalEvent([{ type: "turn.failed" }]), true)
    assert.equal(hasPersistableTerminalEvent([{ type: "error" }]), true)
  })
})

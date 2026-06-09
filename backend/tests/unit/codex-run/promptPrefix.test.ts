import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildSdkInput } from "../../../src/codex-run/promptPrefix.js"
import type { RunContext, RunInputItem } from "../../../src/codex-run/runTypes.js"

const context: RunContext = {
  sessionId: "session-1",
  threadId: "thread-1",
  turnId: "turn-1",
  versionId: "v0001",
  workspaceDir: "/tmp/workspace",
  workspaceId: "ws_test",
}

describe("buildSdkInput", () => {
  it("injects execution context into the first text item", () => {
    const input: RunInputItem[] = [{ type: "text", text: "  user task  " }]
    const result = buildSdkInput(input, context, true, "Guide text", [
      {
        content: "Skill body",
        description: "Skill description",
        file: "/tmp/SKILL.md",
        name: "planner",
      },
    ])

    assert.ok(Array.isArray(result))
    const first = result[0]
    assert.equal(first.type, "text")
    assert.match(first.text, /Execution context:/u)
    assert.match(first.text, /- session_id: session-1/u)
    assert.match(first.text, /Agent guide:\nGuide text/u)
    assert.match(first.text, /## planner/u)
    assert.match(first.text, /user task$/u)
  })

  it("prepends a text prefix when the original input has no text items", () => {
    const input: RunInputItem[] = [{ type: "local_image", path: "/tmp/a.png" }]
    const result = buildSdkInput(input, context, true, "", [])

    assert.ok(Array.isArray(result))
    assert.equal(result[0].type, "text")
    assert.match(result[0].text, /Execution context:/u)
    assert.deepEqual(result[1], input[0])
  })

  it("leaves input untouched when prompt prefix injection is disabled", () => {
    const input: RunInputItem[] = [{ type: "text", text: "user task" }]

    assert.equal(buildSdkInput(input, context, false, "Guide text", []), input)
  })
})

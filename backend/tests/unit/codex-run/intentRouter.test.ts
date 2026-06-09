import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fallbackRouting } from "../../../src/codex-run/intentRouter.js"

describe("fallbackRouting", () => {
  it("routes derating workspaces to check skills", () => {
    const result = fallbackRouting({
      input: "检查降额",
      workspaceId: "ws_check",
      workspaceName: "derating",
    })

    assert.equal(result.intent, "check")
    assert.deepEqual(result.managedSkills, ["task-runner"])
    assert.deepEqual(result.selectedSkills, ["component-derating-classifier"])
    assert.deepEqual(result.skillScopes, ["public", "check"])
    assert.equal(result.source, "fallback")
  })

  it("routes thermal workspaces to the thermal workflow skills", () => {
    const result = fallbackRouting({
      input: "做热仿真",
      workspaceId: "ws_thermal",
    })

    assert.equal(result.intent, "thermal")
    assert.deepEqual(result.selectedSkills, ["planner", "config-editor", "freecad", "simulation-skill"])
    assert.deepEqual(result.skillScopes, ["public", "thermal"])
  })

  it("routes GNC workspaces to the AIGNC orchestrator", () => {
    const result = fallbackRouting({
      input: "设计姿控场景",
      workspaceName: "aignc mission",
    })

    assert.equal(result.intent, "gnc")
    assert.deepEqual(result.selectedSkills, ["aignc-42-orchestrator"])
    assert.deepEqual(result.skillScopes, ["public", "aignc"])
  })

  it("uses the public scope for general requests", () => {
    const result = fallbackRouting({ input: "hello" })

    assert.equal(result.intent, "general")
    assert.deepEqual(result.selectedSkills, [])
    assert.deepEqual(result.skillScopes, ["public"])
  })
})

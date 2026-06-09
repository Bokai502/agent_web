import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  getRequestUserId,
  getRequestUserWorkspaceRoot,
  getRequestWorkspaceRootOverride,
  isGncRequestContext,
  runWithRequestContext,
} from "../../../src/server/requestContext.js"

describe("request context helpers", () => {
  it("returns null or false when no request context is active", () => {
    assert.equal(getRequestUserId(), null)
    assert.equal(getRequestUserWorkspaceRoot(), null)
    assert.equal(getRequestWorkspaceRootOverride(), null)
    assert.equal(isGncRequestContext(), false)
  })

  it("exposes request-scoped values inside async callbacks", async () => {
    await runWithRequestContext({
      isGncRequest: true,
      userId: "alice",
      userWorkspaceRoot: "/tmp/users/alice",
      workspaceRootOverride: "/tmp/users/alice/workspaces",
    }, async () => {
      await Promise.resolve()
      assert.equal(getRequestUserId(), "alice")
      assert.equal(getRequestUserWorkspaceRoot(), "/tmp/users/alice")
      assert.equal(getRequestWorkspaceRootOverride(), "/tmp/users/alice/workspaces")
      assert.equal(isGncRequestContext(), true)
    })
  })
})

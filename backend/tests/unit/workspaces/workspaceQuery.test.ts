import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import {
  getQueryWorkspaceDir,
  isNonEmptyString,
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  resolveQueryWorkspaceDir,
  resolveRequestWorkspaceDir,
  toWorkspaceQueryError,
  WorkspaceQueryError,
} from "../../../src/workspaces/workspaceQuery.js"
import { runWithRequestContext } from "../../../src/server/requestContext.js"

function replyRecorder() {
  return {
    code: 200,
    payload: undefined as unknown,
    send(payload: unknown) {
      this.payload = payload
      return this
    },
    status(code: number) {
      this.code = code
      return this
    },
  } as never as {
    code: number
    payload: unknown
    send(payload: unknown): unknown
    status(code: number): { send(payload: unknown): unknown }
  }
}

describe("workspace query helpers", () => {
  it("normalizes strings and explicit workspace directories under the request root", async () => {
    const root = path.resolve("/tmp/codex-web-test-root")
    const workspaceDir = path.join(root, "case-a")

    assert.equal(isNonEmptyString(" value "), true)
    assert.equal(isNonEmptyString("  "), false)
    assert.equal(getQueryWorkspaceDir("relative-case"), path.resolve("relative-case"))
    assert.equal(getQueryWorkspaceDir(null), null)

    await runWithRequestContext({ workspaceRootOverride: root }, async () => {
      assert.equal(await resolveRequestWorkspaceDir(workspaceDir), workspaceDir)
      assert.equal(await resolveQueryWorkspaceDir({ workspaceDir }), workspaceDir)
      assert.deepEqual(await resolveQueryWorkspaceContext({ workspaceDir }), {
        versionId: null,
        workspaceDir,
        workspaceId: null,
      })
    })
  })

  it("rejects explicit workspace directories outside the request root", async () => {
    const root = path.resolve("/tmp/codex-web-test-root")
    const outside = path.resolve("/tmp/outside-case")

    await runWithRequestContext({ workspaceRootOverride: root }, async () => {
      await assert.rejects(
        () => resolveRequestWorkspaceDir(outside),
        /workspaceDir must be under the workspace data root/u,
      )
      await assert.rejects(
        () => resolveQueryWorkspaceContext({ workspaceDir: outside }),
        (err: unknown) => err instanceof WorkspaceQueryError &&
          err.statusCode === 400 &&
          /workspaceDir must be under the workspace data root/u.test(err.message),
      )
    })
  })

  it("wraps workspace query errors into Fastify-style replies", () => {
    const workspaceError = toWorkspaceQueryError(new Error("manifest mismatch"), 409, "fallback")
    const workspaceReply = replyRecorder()
    const genericReply = replyRecorder()

    replyWithWorkspaceQueryError(workspaceReply as never, workspaceError, "generic failure")
    replyWithWorkspaceQueryError(genericReply as never, "not an error", "generic failure")

    assert.equal(workspaceReply.code, 409)
    assert.deepEqual(workspaceReply.payload, { error: "manifest mismatch" })
    assert.equal(genericReply.code, 500)
    assert.deepEqual(genericReply.payload, { error: "generic failure" })
    assert.equal(toWorkspaceQueryError("bad", 400, "fallback").message, "fallback")
  })
})

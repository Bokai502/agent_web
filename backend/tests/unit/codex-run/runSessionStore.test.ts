import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import {
  completeRunSessionTurn,
  ensureRunSession,
  persistRunSessionTurn,
} from "../../../src/codex-run/runSessionStore.js"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function workspaceDir() {
  return path.join(TEST_DATA_ROOT, "users", "default", "workspaces", "ws_run_store", "versions", "v0001")
}

function historyPath() {
  return path.join(workspaceDir(), "logs", "conversation-history.json")
}

async function readHistory() {
  return JSON.parse(await fs.readFile(historyPath(), "utf-8")) as Array<Record<string, unknown>>
}

describe("runSessionStore", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(workspaceDir(), { recursive: true })
  })

  function withWorkspaceContext<T>(callback: () => Promise<T>) {
    return runWithRequestContext({
      userId: "default",
      userWorkspaceRoot: path.join(TEST_DATA_ROOT, "users", "default"),
      workspaceRootOverride: path.join(TEST_DATA_ROOT, "users", "default"),
    }, callback)
  }

  it("creates and updates run session metadata", async () => {
    await withWorkspaceContext(async () => {
      await ensureRunSession({
        prompt: "Create a new run session title that is deliberately longer than sixty characters.",
        sessionId: "session-run",
        threadId: "thread-1",
        versionId: "v0001",
        workspaceDir: workspaceDir(),
        workspaceId: "ws_run_store",
        workspaceName: null,
      })
    })

    let [session] = await readHistory()
    assert.equal(session.id, "session-run")
    assert.equal(session.threadId, "thread-1")
    assert.equal(session.workspaceName, "v0001")
    assert.equal((session.title as string).length, 60)
    assert.deepEqual(session.turns, [])

    await withWorkspaceContext(async () => {
      await ensureRunSession({
        prompt: "ignored",
        sessionId: "session-run",
        threadId: "thread-2",
        versionId: null,
        workspaceDir: workspaceDir(),
        workspaceId: null,
        workspaceName: "Named Workspace",
      })
    })

    ;[session] = await readHistory()
    assert.equal(session.threadId, "thread-1")
    assert.equal(session.workspaceId, "ws_run_store")
    assert.equal(session.versionId, "v0001")
    assert.equal(session.workspaceName, "Named Workspace")
  })

  it("creates, replaces, and persists session turns", async () => {
    const baseArgs = {
      prompt: "run prompt",
      sessionId: "session-turn",
      threadId: "thread-1",
      turnId: "turn-1",
      versionId: "v0001",
      workspaceDir: workspaceDir(),
      workspaceId: "ws_run_store",
      workspaceName: "Run Workspace",
    }

    await withWorkspaceContext(async () => {
      await completeRunSessionTurn({
        ...baseArgs,
        events: [{ type: "item.completed", item: { text: "first" } }],
      })

      await completeRunSessionTurn({
        ...baseArgs,
        events: [{ type: "turn.completed" }],
        threadId: null,
      })

      await persistRunSessionTurn({
        ...baseArgs,
        events: [{ type: "turn.failed" }],
        turnId: "turn-2",
      })
    })

    const [session] = await readHistory()
    const turns = session.turns as Array<{ events: unknown[]; id: string; userPrompt: string }>

    assert.equal(session.threadId, "thread-1")
    assert.equal(turns.length, 2)
    assert.equal(turns[0].id, "turn-1")
    assert.deepEqual(turns[0].events, [{ type: "turn.completed" }])
    assert.equal(turns[1].id, "turn-2")
    assert.equal(turns[1].userPrompt, "run prompt")
  })
})

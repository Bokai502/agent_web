import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import {
  findWorkspaceSession,
  readAllWorkspaceSessionHistories,
  readWorkspaceSessionHistory,
  removeWorkspaceSessionHistory,
  replaceWorkspaceSessionHistories,
  upsertWorkspaceSessionHistory,
  WORKSPACE_CONVERSATION_HISTORY_FILE,
} from "../../../src/sessions/sessionStore.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

function workspaceDir(name = "ws_sessions") {
  return path.join(userRoot(), "workspaces", name, "versions", "v0001")
}

function historyPath(name = "ws_sessions") {
  return path.join(workspaceDir(name), "logs", WORKSPACE_CONVERSATION_HISTORY_FILE)
}

function withWorkspaceContext<T>(callback: () => Promise<T>) {
  return runWithRequestContext({
    userId: "default",
    userWorkspaceRoot: userRoot(),
    workspaceRootOverride: userRoot(),
  }, callback)
}

describe("session store helpers", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(workspaceDir(), { recursive: true })
  })

  it("ignores invalid workspace directories and malformed history files", async () => {
    await withWorkspaceContext(async () => {
      await upsertWorkspaceSessionHistory({
        id: "outside-session",
        workspaceDir: path.resolve(TEST_DATA_ROOT, "..", "outside-workspace"),
      })
      assert.equal(await fs.access(path.join(TEST_DATA_ROOT, "..", "outside-workspace")).then(() => true).catch(() => false), false)

      await fs.mkdir(path.dirname(historyPath()), { recursive: true })
      await fs.writeFile(historyPath(), "{broken", "utf-8")
      assert.deepEqual(await readWorkspaceSessionHistory(workspaceDir()), [])
      assert.deepEqual(await readAllWorkspaceSessionHistories(), [])
      assert.equal(await findWorkspaceSession("missing-session", workspaceDir()), null)
    })
  })

  it("upserts, merges, replaces, and removes workspace sessions", async () => {
    await withWorkspaceContext(async () => {
      await upsertWorkspaceSessionHistory({
        createdAt: 100,
        id: "session-1",
        turns: [{ events: [{ type: "old" }], id: "turn-1" }],
        workspaceDir: workspaceDir(),
      })
      await upsertWorkspaceSessionHistory({
        createdAt: 200,
        id: "session-1",
        turns: [{ events: [{ type: "new" }, { type: "newer" }], id: "turn-1" }],
        workspaceDir: workspaceDir(),
        workspaceId: "ws_sessions",
      })

      const merged = await findWorkspaceSession("session-1", workspaceDir()) as {
        id?: string
        turns?: Array<{ events: unknown[]; id: string }>
        workspaceId?: string
      }
      assert.equal(merged.id, "session-1")
      assert.equal(merged.workspaceId, "ws_sessions")
      assert.deepEqual(merged.turns?.[0]?.events, [{ type: "new" }, { type: "newer" }])

      await fs.mkdir(workspaceDir("ws_other"), { recursive: true })
      await upsertWorkspaceSessionHistory({
        createdAt: 300,
        id: "session-2",
        turns: [],
        workspaceDir: workspaceDir("ws_other"),
      })

      assert.deepEqual(
        (await readAllWorkspaceSessionHistories()).map(session => session.id),
        ["session-2", "session-1"],
      )

      await replaceWorkspaceSessionHistories([
        {
          createdAt: 400,
          id: "session-3",
          turns: [],
          workspaceDir: workspaceDir(),
        },
      ])
      assert.deepEqual(
        (await readAllWorkspaceSessionHistories()).map(session => session.id),
        ["session-3"],
      )

      await removeWorkspaceSessionHistory({
        id: "session-3",
        workspaceDir: workspaceDir(),
      })
      assert.deepEqual(await readAllWorkspaceSessionHistories(), [])
    })
  })
})

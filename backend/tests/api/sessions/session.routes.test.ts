import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function workspaceDir() {
  return path.join(TEST_DATA_ROOT, "users", "default", "workspaces", "ws_test", "versions", "v0001")
}

function otherWorkspaceDir() {
  return path.join(TEST_DATA_ROOT, "users", "default", "workspaces", "ws_other", "versions", "v0001")
}

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: 1000,
    id: "session-1",
    threadId: "thread-1",
    turns: [
      {
        events: [
          {
            item: {
              id: "message-1",
              text: "final answer",
              type: "agent_message",
            },
            type: "item.completed",
          },
        ],
        id: "turn-1",
        userPrompt: "hello",
      },
    ],
    workspaceDir: workspaceDir(),
    workspaceId: "ws_test",
    workspaceName: "test",
    ...overrides,
  }
}

describe("session routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(workspaceDir(), { recursive: true })
    await fs.mkdir(otherWorkspaceDir(), { recursive: true })
  })

  it("PUT /api/sessions/:id stores a session and GET /api/sessions returns it", async () => {
    const server = await createTestServer()

    try {
      const putResponse = await server.inject({
        method: "PUT",
        payload: sessionPayload(),
        url: "/api/sessions/session-1",
      })
      assert.equal(putResponse.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      const body = getResponse.json()

      assert.equal(getResponse.statusCode, 200)
      assert.equal(body.length, 1)
      assert.equal(body[0].id, "session-1")
      assert.equal(body[0].workspaceId, "ws_test")
    } finally {
      await server.close()
    }
  })

  it("GET /api/agent/messages returns final assistant messages for a turn", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload(),
        url: "/api/sessions/session-1",
      })

      const response = await server.inject({
        method: "GET",
        url: "/api/agent/messages?sessionId=session-1&turnId=turn-1",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.messages.length, 1)
      assert.equal(body.messages[0].text, "final answer")
      assert.equal(body.messages[0].role, "assistant")
    } finally {
      await server.close()
    }
  })

  it("GET /api/agent/messages validates required query parameters", async () => {
    const server = await createTestServer()

    try {
      const missingSession = await server.inject({
        method: "GET",
        url: "/api/agent/messages?turnId=turn-1",
      })
      assert.equal(missingSession.statusCode, 400)
      assert.deepEqual(missingSession.json(), { error: "sessionId and turnId are required" })

      const missingTurn = await server.inject({
        method: "GET",
        url: "/api/agent/messages?sessionId=session-1",
      })
      assert.equal(missingTurn.statusCode, 400)
      assert.deepEqual(missingTurn.json(), { error: "sessionId and turnId are required" })
    } finally {
      await server.close()
    }
  })

  it("filters ask-user protocol messages from agent messages", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload({
          turns: [
            {
              events: [
                {
                  item: {
                    id: "ask-1",
                    text: "<ask-user-question><question>Continue?</question><option>Yes</option><option>No</option></ask-user-question>",
                    type: "agent_message",
                  },
                  type: "item.completed",
                },
                {
                  item: {
                    id: "message-2",
                    text: "visible answer",
                    type: "agent_message",
                  },
                  type: "item.completed",
                },
              ],
              id: "turn-ask",
            },
          ],
        }),
        url: "/api/sessions/session-1",
      })

      const response = await server.inject({
        method: "GET",
        url: "/api/agent/messages?sessionId=session-1&turnId=turn-ask",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.messages.length, 1)
      assert.equal(body.messages[0].text, "visible answer")
    } finally {
      await server.close()
    }
  })

  it("returns only completed non-empty agent messages and falls back to generated item ids", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload({
          createdAt: "not-a-number",
          turns: [
            "bad-turn",
            {
              events: "not-events",
              id: "turn-empty",
            },
            {
              events: [
                null,
                { type: "item.started", item: { id: "started", text: "started", type: "agent_message" } },
                { type: "item.completed", item: { id: "tool", text: "tool", type: "tool_call" } },
                { type: "item.completed", item: { id: "blank", text: "   ", type: "agent_message" } },
                { type: "item.completed", item: { text: "fallback id", type: "agent_message" } },
              ],
              id: "turn-filter",
            },
          ],
        }),
        url: "/api/sessions/session-1",
      })

      const emptyTurn = await server.inject({
        method: "GET",
        url: "/api/agent/messages?sessionId=session-1&turnId=turn-empty",
      })
      assert.equal(emptyTurn.statusCode, 200)
      assert.deepEqual(emptyTurn.json(), { messages: [] })

      const response = await server.inject({
        method: "GET",
        url: "/api/agent/messages?sessionId=session-1&turnId=turn-filter",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.messages.length, 1)
      assert.equal(body.messages[0].createdAt, null)
      assert.equal(body.messages[0].itemId, "event:4")
      assert.equal(body.messages[0].id, "session-1:turn-filter:event:4")
      assert.equal(body.messages[0].sequence, 4)
      assert.equal(body.messages[0].text, "fallback id")
    } finally {
      await server.close()
    }
  })

  it("merges session turns and preserves existing workspace metadata", async () => {
    const server = await createTestServer()

    try {
      const original = await server.inject({
        method: "PUT",
        payload: sessionPayload({
          turns: [
            {
              events: [
                { type: "item.completed", item: { id: "old", text: "old", type: "agent_message" } },
                { type: "other" },
              ],
              id: "turn-merge",
            },
          ],
        }),
        url: "/api/sessions/session-1",
      })
      assert.equal(original.statusCode, 204)

      const beacon = await server.inject({
        method: "POST",
        payload: {
          id: "session-1",
          threadId: null,
          turns: [
            {
              events: [
                { type: "item.completed", item: { id: "new", text: "new", type: "agent_message" } },
              ],
              id: "turn-merge",
            },
            {
              events: [
                { type: "item.completed", item: { id: "second", text: "second", type: "agent_message" } },
              ],
              id: "turn-second",
            },
          ],
        },
        url: "/api/sessions/session-1",
      })
      assert.equal(beacon.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      const [session] = getResponse.json()

      assert.equal(session.threadId, "thread-1")
      assert.equal(session.workspaceId, "ws_test")
      assert.equal(session.turns.length, 2)
      assert.equal(session.turns[0].events.length, 2)
      assert.equal(session.turns[0].events[0].item.text, "old")
      assert.equal(session.turns[1].id, "turn-second")
    } finally {
      await server.close()
    }
  })

  it("POST /api/sessions/:id can create a new single session", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: sessionPayload({ id: "session-post-create" }),
        url: "/api/sessions/session-post-create",
      })
      assert.equal(response.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      const body = getResponse.json()

      assert.equal(getResponse.statusCode, 200)
      assert.equal(body.length, 1)
      assert.equal(body[0].id, "session-post-create")
    } finally {
      await server.close()
    }
  })

  it("rejects invalid single-session write payloads", async () => {
    const server = await createTestServer()

    try {
      const nonObject = await server.inject({
        method: "PUT",
        payload: null,
        url: "/api/sessions/session-1",
      })
      assert.equal(nonObject.statusCode, 400)
      assert.deepEqual(nonObject.json(), { error: "invalid session payload" })

      const mismatchedId = await server.inject({
        method: "POST",
        payload: sessionPayload({ id: "other-session" }),
        url: "/api/sessions/session-1",
      })
      assert.equal(mismatchedId.statusCode, 400)
      assert.deepEqual(mismatchedId.json(), { error: "invalid session payload" })

      const blankPutId = await server.inject({
        method: "PUT",
        payload: sessionPayload({ id: "session-1" }),
        url: "/api/sessions/%20%20",
      })
      assert.equal(blankPutId.statusCode, 400)
      assert.deepEqual(blankPutId.json(), { error: "session id is required" })

      const blankPostId = await server.inject({
        method: "POST",
        payload: sessionPayload({ id: "session-1" }),
        url: "/api/sessions/%20%20",
      })
      assert.equal(blankPostId.statusCode, 400)
      assert.deepEqual(blankPostId.json(), { error: "session id is required" })
    } finally {
      await server.close()
    }
  })

  it("DELETE /api/sessions/:id removes a stored session", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload(),
        url: "/api/sessions/session-1",
      })

      const deleteResponse = await server.inject({ method: "DELETE", url: "/api/sessions/session-1" })
      assert.equal(deleteResponse.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      assert.deepEqual(getResponse.json(), [])
    } finally {
      await server.close()
    }
  })

  it("POST /api/sessions/:id/delete removes a stored session", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload(),
        url: "/api/sessions/session-1",
      })

      const deleteResponse = await server.inject({ method: "POST", url: "/api/sessions/session-1/delete" })
      assert.equal(deleteResponse.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      assert.deepEqual(getResponse.json(), [])
    } finally {
      await server.close()
    }
  })

  it("validates blank session ids for delete routes", async () => {
    const server = await createTestServer()

    try {
      const deleteResponse = await server.inject({ method: "DELETE", url: "/api/sessions/%20%20" })
      assert.equal(deleteResponse.statusCode, 400)
      assert.deepEqual(deleteResponse.json(), { error: "session id is required" })

      const postDeleteResponse = await server.inject({ method: "POST", url: "/api/sessions/%20%20/delete" })
      assert.equal(postDeleteResponse.statusCode, 400)
      assert.deepEqual(postDeleteResponse.json(), { error: "session id is required" })
    } finally {
      await server.close()
    }
  })

  it("POST /api/sessions rejects non-array bodies", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { id: "not-an-array" },
        url: "/api/sessions",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "Body must be a JSON array" })
    } finally {
      await server.close()
    }
  })

  it("POST /api/sessions replaces all valid sessions and enforces limits", async () => {
    const server = await createTestServer()

    try {
      const tooMany = await server.inject({
        method: "POST",
        payload: Array.from({ length: 1001 }, (_, index) => ({ id: `session-${index}` })),
        url: "/api/sessions",
      })
      assert.equal(tooMany.statusCode, 400)
      assert.deepEqual(tooMany.json(), { error: "Too many sessions (max 1000)" })

      const replace = await server.inject({
        method: "POST",
        payload: [
          sessionPayload({ id: "session-1" }),
          { id: "" },
          sessionPayload({ createdAt: 900, id: "session-2", turns: [] }),
        ],
        url: "/api/sessions",
      })
      assert.equal(replace.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      const sessions = getResponse.json()

      assert.deepEqual(sessions.map((session: { id: string }) => session.id), ["session-1", "session-2"])
    } finally {
      await server.close()
    }
  })

  it("POST /api/sessions removes omitted sessions and merges duplicate histories", async () => {
    const server = await createTestServer()

    try {
      await server.inject({
        method: "PUT",
        payload: sessionPayload({ id: "old-session" }),
        url: "/api/sessions/old-session",
      })
      await server.inject({
        method: "PUT",
        payload: sessionPayload({ createdAt: 50, id: "duplicate-session", turns: [{ events: [{ type: "old" }], id: "turn-shared" }] }),
        url: "/api/sessions/duplicate-session",
      })
      await server.inject({
        method: "PUT",
        payload: sessionPayload({
          createdAt: 500,
          id: "duplicate-session",
          turns: [{ events: [{ type: "new" }, { type: "newer" }], id: "turn-shared" }],
          workspaceDir: otherWorkspaceDir(),
          workspaceId: "ws_other",
        }),
        url: "/api/sessions/duplicate-session",
      })

      const replace = await server.inject({
        method: "POST",
        payload: [
          sessionPayload({
            createdAt: 2000,
            id: "newest-session",
            turns: [],
          }),
          sessionPayload({
            createdAt: 100,
            id: "duplicate-session",
            turns: [{ events: [{ type: "incoming" }], id: "turn-shared" }],
            workspaceDir: otherWorkspaceDir(),
            workspaceId: "ws_other",
          }),
        ],
        url: "/api/sessions",
      })
      assert.equal(replace.statusCode, 204)

      const getResponse = await server.inject({ method: "GET", url: "/api/sessions" })
      const sessions = getResponse.json()

      assert.deepEqual(sessions.map((session: { id: string }) => session.id), ["newest-session", "duplicate-session"])
      assert.equal(sessions.some((session: { id: string }) => session.id === "old-session"), false)
      assert.equal(sessions[1].workspaceId, "ws_test")
      assert.deepEqual(sessions[1].turns[0].events, [{ type: "new" }, { type: "newer" }])
    } finally {
      await server.close()
    }
  })
})

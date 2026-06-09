import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function workspaceDir() {
  return path.join(TEST_DATA_ROOT, "users", "default", "workspaces", "ws_test", "versions", "v0001")
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
})

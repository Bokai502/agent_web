import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { resetTestData, TEST_DATA_ROOT } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

describe("codex run route", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(userRoot(), { recursive: true })
  })

  it("returns RunRequestError responses before opening a stream", async () => {
    const server = await createTestServer()

    try {
      const missingInput = await server.inject({
        method: "POST",
        payload: {
          sessionId: "session-1",
          turnId: "turn-1",
        },
        url: "/api/run",
      })

      assert.equal(missingInput.statusCode, 400)
      assert.deepEqual(missingInput.json(), { error: "prompt or input is required" })

      const response = await server.inject({
        method: "POST",
        payload: {
          prompt: "hello",
          turnId: "turn-1",
        },
        url: "/api/run",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "sessionId is required" })

      const invalidBackend = await server.inject({
        method: "POST",
        payload: {
          modelBackend: "local",
          prompt: "hello",
          sessionId: "session-1",
          turnId: "turn-1",
        },
        url: "/api/run",
      })

      assert.equal(invalidBackend.statusCode, 400)
      assert.deepEqual(invalidBackend.json(), { error: "modelBackend must be one of: openai, chatModel" })
    } finally {
      await server.close()
    }
  })

  it("streams Codex run events over SSE and closes the response", async () => {
    const server = await createTestServer({
      config: createTestConfig({
        codex: {
          modelProvider: "test_provider",
          modelProviderName: "test_provider",
          supportsWebsockets: false,
          wireApi: "responses",
        },
        chatModel: {
          apiKey: "invalid-test-key",
          baseUrl: "http://127.0.0.1:9",
          model: "test-model",
        },
      }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          prompt: "hello from test",
          sessionId: "session-run-route",
          turnId: "turn-run-route",
        },
        url: "/api/run",
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.headers["content-type"] as string, /text\/event-stream/u)
      assert.match(response.headers["cache-control"] as string, /no-cache/u)
      assert.match(response.headers["access-control-allow-origin"] as string, /\*/u)
      assert.match(response.body, /data: /u)
      assert.match(response.body, /"type":"error"/u)
    } finally {
      await server.close()
    }
  })
})

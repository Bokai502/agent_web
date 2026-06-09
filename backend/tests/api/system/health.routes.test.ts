import assert from "node:assert/strict"
import { afterEach, describe, it, mock } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"

describe("GET /api/health", () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it("returns 200 when the configured OpenAI-compatible endpoint is reachable", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/health" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.ok, true)
      assert.equal(body.baseUrl, "http://127.0.0.1:9")
      assert.equal(body.model, "test-model")
    } finally {
      await server.close()
    }
  })

  it("returns 503 when the endpoint rejects authentication", async () => {
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 401 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/health" })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.equal(body.ok, false)
      assert.equal(body.reason, "auth_failed")
      assert.equal(body.status, 401)
    } finally {
      await server.close()
    }
  })
})

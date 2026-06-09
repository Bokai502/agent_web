import assert from "node:assert/strict"
import { describe, it } from "node:test"
import path from "node:path"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("auth routes", () => {
  it("GET /api/auth/me reports the resolved development user", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/auth/me" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.authEnabled, false)
      assert.equal(body.cookieName, "codex_user_id")
      assert.equal(body.userId, "default")
      assert.equal(body.workspaceRoot, path.join(TEST_DATA_ROOT, "users", "default"))
    } finally {
      await server.close()
    }
  })

  it("POST /api/auth/logout clears the user cookie", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "POST", url: "/api/auth/logout" })

      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), { ok: true })
      assert.match(response.headers["set-cookie"] as string, /^codex_user_id=; Path=\/; SameSite=Lax; Max-Age=0/u)
    } finally {
      await server.close()
    }
  })

  it("rejects non-auth API requests when auth is enabled and no user is supplied", async () => {
    const server = await createTestServer({
      config: createTestConfig({ auth: { enabled: true } }),
    })

    try {
      const response = await server.inject({ method: "GET", url: "/api/skills" })

      assert.equal(response.statusCode, 401)
    } finally {
      await server.close()
    }
  })
})

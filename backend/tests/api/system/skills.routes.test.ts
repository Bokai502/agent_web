import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"

describe("GET /api/skills", () => {
  it("returns the cached skills available to the default workspace context", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/skills" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.ok(Array.isArray(body))
      assert.ok(body.some((skill: { name?: string }) => skill.name === "component-derating-classifier"))
    } finally {
      await server.close()
    }
  })

  it("keeps GNC-prefixed requests on GNC-capable skill scopes", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/gnc/skills" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.ok(Array.isArray(body))
      assert.ok(body.some((skill: { name?: string }) => skill.name === "aignc-42-orchestrator"))
      assert.equal(body.some((skill: { name?: string }) => skill.name === "freecad"), false)
    } finally {
      await server.close()
    }
  })
})

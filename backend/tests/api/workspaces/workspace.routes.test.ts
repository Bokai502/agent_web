import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

async function createWorkspace(name: string) {
  await fs.mkdir(path.join(userRoot(), name, "00_inputs"), { recursive: true })
}

describe("workspace routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(userRoot(), { recursive: true })
  })

  it("GET /api/workspace/workspaces lists valid user workspaces", async () => {
    await createWorkspace("thermal_case")
    await fs.mkdir(path.join(userRoot(), "invalid_case"), { recursive: true })
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/workspace/workspaces" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.root, userRoot())
      assert.ok(body.items.some((item: { name?: string; valid?: boolean }) => item.name === "thermal_case" && item.valid))
      assert.equal(body.items.some((item: { name?: string }) => item.name === "invalid_case"), false)
      assert.equal(response.headers["cache-control"], "no-cache")
    } finally {
      await server.close()
    }
  })

  it("POST /api/workspace/workspace selects a valid workspace", async () => {
    await createWorkspace("thermal_case")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { name: "thermal_case" },
        url: "/api/workspace/workspace",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.currentName, "thermal_case")
      assert.equal(body.current, path.join(userRoot(), "thermal_case"))
      assert.equal(body.item.valid, true)
    } finally {
      await server.close()
    }
  })

  it("POST /api/workspace/workspace rejects path traversal names", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { name: "../outside" },
        url: "/api/workspace/workspace",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "workspace name must be a direct child directory" })
    } finally {
      await server.close()
    }
  })
})

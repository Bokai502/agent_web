import assert from "node:assert/strict"
import fs from "node:fs/promises"
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

  it("switches development users and seeds available template workspaces", async () => {
    const templateDir = path.join(TEST_DATA_ROOT, "templates")
    await fs.mkdir(path.join(templateDir, "derating", "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(templateDir, "derating", "00_inputs", "input.txt"), "seed", "utf-8")
    await fs.mkdir(path.join(templateDir, "thermal_catch", "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(templateDir, "thermal_catch", "00_inputs", "input.txt"), "catch-seed", "utf-8")

    const usersRoot = path.join(TEST_DATA_ROOT, "users")
    const server = await createTestServer({
      config: createTestConfig({
        auth: {
          devUserId: "default-user",
          usersDir: usersRoot,
        },
        workspace: {
          templateDir,
          usersRoot,
        },
      }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: { userId: "../Alice Smith!" },
        url: "/api/auth/user",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.userId, ".._Alice_Smith")
      assert.match(response.headers["set-cookie"] as string, /^codex_user_id=\.\._Alice_Smith; Path=\/; SameSite=Lax/u)
      assert.deepEqual(body.seeded.find((item: { name: string }) => item.name === "derating"), {
        copied: true,
        name: "derating",
        workspaceId: "ws_derating",
      })
      assert.deepEqual(body.seeded.find((item: { name: string }) => item.name === "gnc"), {
        copied: false,
        name: "gnc",
        reason: "template-missing",
        workspaceId: "ws_gnc",
      })
      assert.deepEqual(body.workspaces.find((item: { name: string }) => item.name === "gnc"), {
        copied: false,
        name: "gnc",
        reason: "template-missing",
        workspaceId: "ws_gnc",
      })
      assert.deepEqual(body.seeded.find((item: { name: string }) => item.name === "thermal_catch"), {
        copied: true,
        name: "thermal_catch",
        workspaceId: "ws_thermal_catch",
      })
      assert.equal(body.workspaces.find((item: { name: string }) => item.name === "derating").workspaceId, "ws_derating")
      assert.equal(await fs.access(path.join(usersRoot, ".._Alice_Smith", "derating")).then(() => true).catch(() => false), false)
      assert.equal(
        await fs.readFile(path.join(usersRoot, ".._Alice_Smith", "workspaces", "ws_derating", "versions", "v0001", "00_inputs", "input.txt"), "utf-8"),
        "seed",
      )
      assert.equal(
        await fs.readFile(path.join(usersRoot, ".._Alice_Smith", "workspaces", "ws_thermal_catch", "versions", "v0001", "00_inputs", "input.txt"), "utf-8"),
        "catch-seed",
      )

      const repeat = await server.inject({
        method: "POST",
        payload: { userId: "../Alice Smith!" },
        url: "/api/auth/user",
      })
      assert.equal(repeat.statusCode, 200)
      assert.deepEqual(repeat.json().seeded.find((item: { name: string }) => item.name === "derating"), {
        copied: false,
        name: "derating",
        reason: "already-exists",
        workspaceId: "ws_derating",
      })
    } finally {
      await server.close()
    }
  })

  it("disables development user switching when auth is enabled", async () => {
    const server = await createTestServer({
      config: createTestConfig({ auth: { enabled: true } }),
    })

    try {
      const response = await server.inject({
        headers: { "x-codex-user-id": "real-user" },
        method: "POST",
        payload: { userId: "other-user" },
        url: "/api/auth/user",
      })

      assert.equal(response.statusCode, 403)
      assert.deepEqual(response.json(), { error: "user switching is disabled when auth is enabled" })
    } finally {
      await server.close()
    }
  })
})

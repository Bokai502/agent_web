import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { refreshSkillsCache } from "../../../src/system/skills.js"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createTestLogger } from "../../helpers/testLogger.js"

async function withFreshSkillsCache<T>(callback: () => Promise<T>) {
  const cachePath = path.resolve(process.cwd(), "skills.json")
  const original = await fs.readFile(cachePath, "utf-8").catch(() => null)
  refreshSkillsCache(createTestLogger())
  try {
    return await callback()
  } finally {
    if (original === null) {
      await fs.rm(cachePath, { force: true })
    } else {
      await fs.writeFile(cachePath, original, "utf-8")
    }
  }
}

describe("GET /api/skills", () => {
  it("returns the cached skills available to the default workspace context", async () => {
    await withFreshSkillsCache(async () => {
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
  })

  it("keeps GNC-prefixed requests on GNC-capable skill scopes", async () => {
    await withFreshSkillsCache(async () => {
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
})

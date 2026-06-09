import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
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
    await installNoopWorkspaceCommands()
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

  it("uses the persisted current workspace selection when listing workspaces", async () => {
    await createWorkspace("alpha")
    await createWorkspace("beta")
    await fs.writeFile(path.join(userRoot(), ".current-workspace.json"), JSON.stringify({ name: "beta" }), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/workspace/workspaces" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.currentName, "beta")
      assert.equal(body.current, path.join(userRoot(), "beta"))
      assert.deepEqual(body.items.map((item: { name: string }) => item.name), ["alpha", "beta"])
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

  it("lists and selects versioned manifest workspaces by active version", async () => {
    await createManifestFixture("ws_versioned_case")
    const server = await createTestServer()

    try {
      const listResponse = await server.inject({ method: "GET", url: "/api/workspace/workspaces" })
      const versionedItem = listResponse.json().items.find((item: { name?: string }) => item.name === "versioned_case")

      assert.equal(listResponse.statusCode, 200)
      assert.equal(versionedItem.valid, true)
      assert.equal(versionedItem.manifestRoot, path.join(userRoot(), "workspaces", "ws_versioned_case"))
      assert.equal(versionedItem.versionWorkspaceDir, versionDir("v0001", "ws_versioned_case"))
      assert.equal(versionedItem.path, versionDir("v0001", "ws_versioned_case"))

      const selectResponse = await server.inject({
        method: "POST",
        payload: { name: "versioned_case" },
        url: "/api/workspace/workspace",
      })
      const body = selectResponse.json()

      assert.equal(selectResponse.statusCode, 200)
      assert.equal(body.currentName, "versioned_case")
      assert.equal(body.current, versionDir("v0001", "ws_versioned_case"))
      assert.equal(body.item.sourcePath, path.join(userRoot(), "versioned_case"))
    } finally {
      await server.close()
    }
  })

  it("lists versioned workspaces when manifests use stale active version paths", async () => {
    const fixture = await createManifestFixture("ws_stale_version_path")
    const fallbackVersionDir = versionDir("v0002", "ws_stale_version_path")
    await fs.mkdir(path.join(fallbackVersionDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(fallbackVersionDir, "00_inputs", "input.txt"), "v2", "utf-8")
    await fs.writeFile(path.join(fixture.rootDir, "workspace_manifest.json"), JSON.stringify({
      ...fixture.manifest,
      activeVersionId: "v0002",
      versions: [
        ...fixture.manifest.versions,
        {
          createdAt: "2026-01-01T00:02:00.000Z",
          group: "test",
          id: "v0002",
          parentVersionId: "v0001",
          status: "active",
          updatedAt: "2026-01-01T00:02:00.000Z",
          workspaceDir: path.join(userRoot(), "outside", "stale-v0002"),
        },
      ],
    }), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/workspace/workspaces" })
      const item = response.json().items.find((entry: { name?: string }) => entry.name === "stale_version_path")

      assert.equal(response.statusCode, 200)
      assert.equal(item.valid, true)
      assert.equal(item.path, fallbackVersionDir)
      assert.equal(item.versionWorkspaceDir, fallbackVersionDir)
    } finally {
      await server.close()
    }
  })

  it("lists workspace manifest directories with ws_ prefixes as selectable names", async () => {
    await createManifestFixture("ws_prefixed_case")
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/workspace/workspaces" })
      const body = response.json()
      const item = body.items.find((entry: { name?: string }) => entry.name === "prefixed_case")

      assert.equal(response.statusCode, 200)
      assert.equal(item.valid, true)
      assert.equal(item.manifestRoot, path.join(userRoot(), "workspaces", "ws_prefixed_case"))
      assert.equal(item.path, versionDir("v0001", "ws_prefixed_case"))
      assert.equal(body.items.some((entry: { name?: string }) => entry.name === "ws_prefixed_case"), false)
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

  it("POST /api/workspace/workspace rejects missing names and incomplete workspaces", async () => {
    await fs.mkdir(path.join(userRoot(), "incomplete_case"), { recursive: true })
    const server = await createTestServer()

    try {
      const missingName = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/workspace/workspace",
      })
      assert.equal(missingName.statusCode, 400)
      assert.deepEqual(missingName.json(), { error: "workspace name is required" })

      const incomplete = await server.inject({
        method: "POST",
        payload: { name: "incomplete_case" },
        url: "/api/workspace/workspace",
      })
      assert.equal(incomplete.statusCode, 400)
      assert.deepEqual(incomplete.json(), { error: "workspace is missing required files: 00_inputs" })
    } finally {
      await server.close()
    }
  })
})

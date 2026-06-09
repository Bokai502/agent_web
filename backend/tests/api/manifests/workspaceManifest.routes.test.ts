import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, userRoot, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("workspace manifest routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
  })

  it("reads manifests by legacy session route, workspace manifest route, and workspace index route", async () => {
    const server = await createTestServer()

    try {
      const legacyResponse = await server.inject({
        method: "GET",
        url: `/api/workspaces/ws_manifest_test/manifest?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(legacyResponse.statusCode, 200)
      assert.equal(legacyResponse.json().workspaceId, "ws_manifest_test")

      const workspaceResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-manifest?workspaceKey=ws_manifest_test&workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(workspaceResponse.statusCode, 200)
      assert.equal(workspaceResponse.json().activeVersionId, "v0001")

      const indexResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-index/ws_manifest_test/manifest?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(indexResponse.statusCode, 200)
      assert.equal(indexResponse.json().versions[0].id, "v0001")
    } finally {
      await server.close()
    }
  })

  it("initializes a manifest for a new workspace locator", async () => {
    const sourceWorkspaceDir = path.join(userRoot(), "plain_source_workspace")
    await fs.mkdir(path.join(sourceWorkspaceDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(sourceWorkspaceDir, "00_inputs", "source.txt"), "source", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace-manifest?initialize=1&workspaceKey=ws_new&sourceWorkspaceDir=${encodeURIComponent(sourceWorkspaceDir)}`,
      })

      assert.equal(response.statusCode, 200)
      assert.equal(response.json().workspaceId, "ws_new")
      assert.equal(response.json().activeVersionId, "v0001")
      assert.equal(response.json().versions.length, 1)
    } finally {
      await server.close()
    }
  })

  it("initializes manifests through legacy and workspace-index routes", async () => {
    const legacySourceDir = path.join(userRoot(), "legacy_source_workspace")
    const indexSourceDir = path.join(userRoot(), "index_source_workspace")
    await fs.mkdir(path.join(legacySourceDir, "00_inputs"), { recursive: true })
    await fs.mkdir(path.join(indexSourceDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(legacySourceDir, "00_inputs", "legacy.txt"), "legacy", "utf-8")
    await fs.writeFile(path.join(indexSourceDir, "00_inputs", "index.txt"), "index", "utf-8")
    const server = await createTestServer()

    try {
      const legacyResponse = await server.inject({
        method: "GET",
        url: `/api/workspaces/ws_legacy_new/manifest?initialize=true&sourceWorkspaceDir=${encodeURIComponent(legacySourceDir)}`,
      })
      assert.equal(legacyResponse.statusCode, 200)
      assert.equal(legacyResponse.json().workspaceId, "ws_legacy_new")
      assert.equal(legacyResponse.json().versions[0].workspaceDir.includes("ws_legacy_new"), true)

      const indexResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-index/ws_index_new/manifest?initialize=1&sourceWorkspaceDir=${encodeURIComponent(indexSourceDir)}`,
      })
      assert.equal(indexResponse.statusCode, 200)
      assert.equal(indexResponse.json().workspaceId, "ws_index_new")
      assert.equal(indexResponse.json().activeVersionId, "v0001")
    } finally {
      await server.close()
    }
  })

  it("uses workspaceDir as the source directory when initializing manifests without sourceWorkspaceDir", async () => {
    const legacyWorkspaceDir = path.join(userRoot(), "legacy_workspace_dir_source")
    const workspaceManifestDir = path.join(userRoot(), "workspace_manifest_dir_source")
    const indexWorkspaceDir = path.join(userRoot(), "index_workspace_dir_source")
    await fs.mkdir(path.join(legacyWorkspaceDir, "00_inputs"), { recursive: true })
    await fs.mkdir(path.join(workspaceManifestDir, "00_inputs"), { recursive: true })
    await fs.mkdir(path.join(indexWorkspaceDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(legacyWorkspaceDir, "00_inputs", "legacy.txt"), "legacy", "utf-8")
    await fs.writeFile(path.join(workspaceManifestDir, "00_inputs", "workspace.txt"), "workspace", "utf-8")
    await fs.writeFile(path.join(indexWorkspaceDir, "00_inputs", "index.txt"), "index", "utf-8")
    const server = await createTestServer()

    try {
      const legacyResponse = await server.inject({
        method: "GET",
        url: `/api/workspaces/ws_legacy_workspace_dir/manifest?initialize=1&workspaceDir=${encodeURIComponent(legacyWorkspaceDir)}`,
      })
      assert.equal(legacyResponse.statusCode, 200)
      assert.equal(legacyResponse.json().workspaceId, "ws_legacy_workspace_dir")

      const workspaceResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-manifest?initialize=true&workspaceKey=ws_workspace_dir&workspaceDir=${encodeURIComponent(workspaceManifestDir)}`,
      })
      assert.equal(workspaceResponse.statusCode, 200)
      assert.equal(workspaceResponse.json().workspaceId, "ws_workspace_dir")

      const indexResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-index/ws_index_workspace_dir/manifest?initialize=1&workspaceDir=${encodeURIComponent(indexWorkspaceDir)}`,
      })
      assert.equal(indexResponse.statusCode, 200)
      assert.equal(indexResponse.json().workspaceId, "ws_index_workspace_dir")
    } finally {
      await server.close()
    }
  })

  it("reports errors for missing manifest locators and invalid workspace directories", async () => {
    const server = await createTestServer()

    try {
      const missingKeyResponse = await server.inject({
        method: "GET",
        url: "/api/workspace-manifest",
      })
      assert.equal(missingKeyResponse.statusCode, 400)
      assert.match(missingKeyResponse.json().error, /workspaceDir or sessionId is required/u)

      const missingDirResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-manifest?initialize=1&workspaceKey=ws_missing&sourceWorkspaceDir=${encodeURIComponent(path.join(userRoot(), "missing-source"))}`,
      })
      assert.equal(missingDirResponse.statusCode, 400)
      assert.match(missingDirResponse.json().error, /source workspace 00_inputs does not exist/u)

      const missingIndexDirResponse = await server.inject({
        method: "GET",
        url: `/api/workspace-index/ws_missing/manifest?initialize=true&sourceWorkspaceDir=${encodeURIComponent(path.join(userRoot(), "missing-index-source"))}`,
      })
      assert.equal(missingIndexDirResponse.statusCode, 400)
      assert.match(missingIndexDirResponse.json().error, /source workspace 00_inputs does not exist/u)
    } finally {
      await server.close()
    }
  })
})

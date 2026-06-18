import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, userRoot, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("version manifest routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
  })

  it("branches, checks out, commits, fails, diffs, and deletes versions", async () => {
    const server = await createTestServer()

    try {
      const branchResponse = await server.inject({
        method: "POST",
        payload: {
          label: "branch",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/versions/v0001/branch",
      })
      assert.equal(branchResponse.statusCode, 200)
      assert.equal(branchResponse.json().version.id, "v0002")
      assert.equal(branchResponse.json().version.parentVersionId, "v0001")

      await fs.writeFile(path.join(versionDir("v0002"), "00_inputs", "branch.txt"), "branch", "utf-8")

      const checkoutResponse = await server.inject({
        method: "POST",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v0001/checkout",
      })
      assert.equal(checkoutResponse.statusCode, 200)
      assert.equal(checkoutResponse.json().activeVersionId, "v0001")

      const commitResponse = await server.inject({
        method: "POST",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v0001/commit",
      })
      assert.equal(commitResponse.statusCode, 200)
      assert.equal(commitResponse.json().versions.find((version: { id: string }) => version.id === "v0001").status, "committed")

      const failResponse = await server.inject({
        method: "POST",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v0002/fail",
      })
      assert.equal(failResponse.statusCode, 200)
      assert.equal(failResponse.json().versions.find((version: { id: string }) => version.id === "v0002").status, "failed")

      const diffResponse = await server.inject({
        method: "GET",
        url: "/api/versions/v0001/diff/v0002?workspaceId=ws_manifest_test",
      })
      assert.equal(diffResponse.statusCode, 200)
      assert.deepEqual(diffResponse.json().added, ["00_inputs/branch.txt"])

      const deleteResponse = await server.inject({
        method: "DELETE",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v0002",
      })
      assert.equal(deleteResponse.statusCode, 200)
      assert.equal(deleteResponse.json().versionId, "v0002")
      assert.equal(deleteResponse.json().manifest.versions.some((version: { id: string }) => version.id === "v0002"), false)
    } finally {
      await server.close()
    }
  })

  it("validates required workspace locator for branch requests", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/versions/v0001/branch",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "workspaceId, workspaceKey or workspaceDir is required" })
    } finally {
      await server.close()
    }
  })

  it("branches a root version as a sibling when parentVersionId is null", async () => {
    const server = await createTestServer()

    try {
      const branchResponse = await server.inject({
        method: "POST",
        payload: {
          label: "root sibling",
          parentVersionId: null,
          workspaceId: "ws_manifest_test",
        },
        url: "/api/versions/v0001/branch",
      })

      assert.equal(branchResponse.statusCode, 200)
      assert.equal(branchResponse.json().version.id, "v0002")
      assert.equal(branchResponse.json().version.parentVersionId, null)
      assert.deepEqual(
        branchResponse.json().manifest.versions.map((version: { id: string; parentVersionId: string | null }) => [version.id, version.parentVersionId]),
        [["v0001", null], ["v0002", null]],
      )
    } finally {
      await server.close()
    }
  })

  it("branches a root version from template inputs when the workspace source has no inputs", async () => {
    const sourceWorkspaceDir = path.join(userRoot(), "thermal_catch")
    const templateWorkspaceDir = path.resolve(process.cwd(), "..", "data", "input_data", "thermal_catch")
    await fs.mkdir(sourceWorkspaceDir, { recursive: true })
    await fs.mkdir(path.join(templateWorkspaceDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(templateWorkspaceDir, "00_inputs", "cad_build_spec.json"), "{}", "utf-8")

    const server = await createTestServer()

    try {
      const branchResponse = await server.inject({
        method: "POST",
        payload: {
          label: "from input",
          parentVersionId: null,
          sourceWorkspaceDir,
          sourceWorkspaceName: "thermal_catch",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/versions/v0001/branch",
      })

      assert.equal(branchResponse.statusCode, 200)
      assert.equal(branchResponse.json().version.id, "v0002")
      assert.equal(branchResponse.json().version.parentVersionId, null)
      assert.equal(
        await fs.readFile(path.join(versionDir("v0002"), "00_inputs", "cad_build_spec.json"), "utf-8"),
        "{}",
      )
      await assert.rejects(
        () => fs.access(path.join(versionDir("v0002"), "00_inputs", "input.txt")),
      )
    } finally {
      await server.close()
    }
  })

  it("validates workspace locators for checkout and delete requests", async () => {
    const server = await createTestServer()

    try {
      const checkoutResponse = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/versions/v0001/checkout",
      })
      assert.equal(checkoutResponse.statusCode, 400)
      assert.deepEqual(checkoutResponse.json(), { error: "workspaceId, workspaceKey or workspaceDir is required" })

      const deleteResponse = await server.inject({
        method: "DELETE",
        payload: {},
        url: "/api/versions/v0001",
      })
      assert.equal(deleteResponse.statusCode, 400)
      assert.deepEqual(deleteResponse.json(), { error: "workspaceId, workspaceKey or workspaceDir is required" })
    } finally {
      await server.close()
    }
  })

  it("does not delete the initial version", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "DELETE",
        payload: { workspaceKey: "ws_manifest_test" },
        url: "/api/versions/v0001",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "cannot delete the initial version" })
    } finally {
      await server.close()
    }
  })

  it("accepts legacy sessionId and workspaceKey locators for version operations", async () => {
    const server = await createTestServer()

    try {
      const branchResponse = await server.inject({
        method: "POST",
        payload: {
          label: "legacy branch",
          sessionId: "ws_manifest_test",
        },
        url: "/api/versions/v0001/branch",
      })
      assert.equal(branchResponse.statusCode, 200)
      assert.equal(branchResponse.json().version.id, "v0002")

      const checkoutResponse = await server.inject({
        method: "POST",
        payload: { workspaceKey: "ws_manifest_test" },
        url: "/api/versions/v0001/checkout",
      })
      assert.equal(checkoutResponse.statusCode, 200)
      assert.equal(checkoutResponse.json().activeVersionId, "v0001")

      const deleteResponse = await server.inject({
        method: "DELETE",
        payload: { sessionId: "ws_manifest_test" },
        url: "/api/versions/v0002",
      })
      assert.equal(deleteResponse.statusCode, 200)
      assert.equal(deleteResponse.json().versionId, "v0002")
    } finally {
      await server.close()
    }
  })

  it("accepts workspaceDir locators for branch, checkout, commit, fail, and delete", async () => {
    const server = await createTestServer()
    const workspaceDir = versionDir()

    try {
      const branchResponse = await server.inject({
        method: "POST",
        payload: {
          group: "workspace-dir-group",
          label: "workspace dir branch",
          workspaceDir,
        },
        url: "/api/versions/v0001/branch",
      })
      const branchBody = branchResponse.json()

      assert.equal(branchResponse.statusCode, 200)
      assert.equal(branchBody.version.id, "v0002")
      assert.equal(branchBody.version.group, "workspace-dir-group")

      const checkoutResponse = await server.inject({
        method: "POST",
        payload: { workspaceDir: versionDir("v0002") },
        url: "/api/versions/v0001/checkout",
      })
      assert.equal(checkoutResponse.statusCode, 200)
      assert.equal(checkoutResponse.json().activeVersionId, "v0001")

      const commitResponse = await server.inject({
        method: "POST",
        payload: { workspaceDir },
        url: "/api/versions/v0001/commit",
      })
      assert.equal(commitResponse.statusCode, 200)
      assert.equal(commitResponse.json().versions.find((version: { id: string }) => version.id === "v0001").status, "committed")

      const failResponse = await server.inject({
        method: "POST",
        payload: { workspaceDir: versionDir("v0002") },
        url: "/api/versions/v0002/fail",
      })
      assert.equal(failResponse.statusCode, 200)
      assert.equal(failResponse.json().versions.find((version: { id: string }) => version.id === "v0002").status, "failed")

      const deleteResponse = await server.inject({
        method: "DELETE",
        payload: { workspaceDir: versionDir("v0002") },
        url: "/api/versions/v0002",
      })
      assert.equal(deleteResponse.statusCode, 200)
      assert.equal(deleteResponse.json().versionId, "v0002")
    } finally {
      await server.close()
    }
  })

  it("returns route errors for missing versions and diff workspace ids", async () => {
    const server = await createTestServer()

    try {
      const commitMissing = await server.inject({
        method: "POST",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v9999/commit",
      })
      assert.equal(commitMissing.statusCode, 400)
      assert.match(commitMissing.json().error, /version not found: v9999/u)

      const failMissing = await server.inject({
        method: "POST",
        payload: { workspaceId: "ws_manifest_test" },
        url: "/api/versions/v9999/fail",
      })
      assert.equal(failMissing.statusCode, 400)
      assert.match(failMissing.json().error, /version not found: v9999/u)

      const diffMissingWorkspace = await server.inject({
        method: "GET",
        url: "/api/versions/v0001/diff/v9999",
      })
      assert.equal(diffMissingWorkspace.statusCode, 400)
      assert.deepEqual(diffMissingWorkspace.json(), { error: "workspaceId is required" })

      const diffMissingVersion = await server.inject({
        method: "GET",
        url: "/api/versions/v0001/diff/v9999?workspaceId=ws_manifest_test",
      })
      assert.equal(diffMissingVersion.statusCode, 400)
      assert.match(diffMissingVersion.json().error, /version not found: v9999/u)
    } finally {
      await server.close()
    }
  })

  it("reports route errors for non-object version bodies and missing locator manifests", async () => {
    const server = await createTestServer()

    try {
      const branchWithArrayBody = await server.inject({
        method: "POST",
        payload: [],
        url: "/api/versions/v0001/branch",
      })
      assert.equal(branchWithArrayBody.statusCode, 400)
      assert.deepEqual(branchWithArrayBody.json(), { error: "workspaceId, workspaceKey or workspaceDir is required" })

      const checkoutWithArrayBody = await server.inject({
        method: "POST",
        payload: [],
        url: "/api/versions/v0001/checkout",
      })
      assert.equal(checkoutWithArrayBody.statusCode, 400)
      assert.deepEqual(checkoutWithArrayBody.json(), { error: "workspaceId, workspaceKey or workspaceDir is required" })

      const commitWithArrayBody = await server.inject({
        method: "POST",
        payload: [],
        url: "/api/versions/v0001/commit",
      })
      assert.equal(commitWithArrayBody.statusCode, 400)
      assert.match(commitWithArrayBody.json().error, /workspaceDir or sessionId is required/u)

      const deleteMissingVersion = await server.inject({
        method: "DELETE",
        payload: { workspaceDir: versionDir() },
        url: "/api/versions/v9999",
      })
      assert.equal(deleteMissingVersion.statusCode, 400)
      assert.match(deleteMissingVersion.json().error, /version not found: v9999/u)

      const checkoutMissingVersion = await server.inject({
        method: "POST",
        payload: { workspaceDir: versionDir() },
        url: "/api/versions/v9999/checkout",
      })
      assert.equal(checkoutMissingVersion.statusCode, 400)
      assert.match(checkoutMissingVersion.json().error, /version not found: v9999/u)
    } finally {
      await server.close()
    }
  })
})

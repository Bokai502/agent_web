import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("run manifest routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
  })

  it("creates, reads, patches, cancels, and retries a run", async () => {
    const server = await createTestServer()

    try {
      const createResponse = await server.inject({
        method: "POST",
        payload: {
          id: "run-1",
          kind: "cad",
          skillNames: ["planner"],
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/runs",
      })
      assert.equal(createResponse.statusCode, 200)
      assert.equal(createResponse.json().run.id, "run-1")
      assert.equal(createResponse.json().run.status, "queued")
      assert.equal(createResponse.json().run.workspaceDir, versionDir())

      const readResponse = await server.inject({
        method: "GET",
        url: "/api/runs/run-1?workspaceId=ws_manifest_test",
      })
      assert.equal(readResponse.statusCode, 200)
      assert.equal(readResponse.json().run.kind, "cad")

      const patchResponse = await server.inject({
        method: "PATCH",
        payload: {
          status: "running",
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/runs/run-1",
      })
      assert.equal(patchResponse.statusCode, 200)
      assert.equal(patchResponse.json().run.status, "running")

      const cancelResponse = await server.inject({
        method: "POST",
        payload: {
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/runs/run-1/cancel",
      })
      assert.equal(cancelResponse.statusCode, 200)
      assert.equal(cancelResponse.json().run.status, "cancelled")

      const retryResponse = await server.inject({
        method: "POST",
        payload: {
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/runs/run-1/retry",
      })
      assert.equal(retryResponse.statusCode, 200)
      assert.equal(retryResponse.json().run.retryOfRunId, "run-1")
      assert.equal(retryResponse.json().run.status, "queued")
      assert.notEqual(retryResponse.json().run.id, "run-1")
    } finally {
      await server.close()
    }
  })

  it("creates and updates runs using workspaceDir locators", async () => {
    const server = await createTestServer()
    const workspaceDir = versionDir()

    try {
      const createResponse = await server.inject({
        method: "POST",
        payload: {
          id: "run-workspace-dir",
          kind: "analysis",
          workspaceDir,
        },
        url: "/api/runs",
      })
      const created = createResponse.json()

      assert.equal(createResponse.statusCode, 200)
      assert.equal(created.run.id, "run-workspace-dir")
      assert.equal(created.run.versionId, "v0001")
      assert.equal(created.run.workspaceDir, workspaceDir)
      assert.equal(created.run.workspaceId, "ws_manifest_test")

      const patchResponse = await server.inject({
        method: "PATCH",
        payload: {
          status: "completed",
          workspaceDir,
        },
        url: "/api/runs/run-workspace-dir",
      })
      const patched = patchResponse.json()

      assert.equal(patchResponse.statusCode, 200)
      assert.equal(patched.run.status, "completed")
      assert.equal(patched.run.workspaceDir, workspaceDir)
    } finally {
      await server.close()
    }
  })

  it("validates required workspaceId when reading a run", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/runs/run-1" })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "workspaceId is required" })
    } finally {
      await server.close()
    }
  })

  it("reports route errors for invalid run create and missing runs", async () => {
    const server = await createTestServer()

    try {
      const createResponse = await server.inject({
        method: "POST",
        payload: {
          id: "run-without-workspace",
          kind: "cad",
        },
        url: "/api/runs",
      })
      assert.equal(createResponse.statusCode, 400)
      assert.match(createResponse.json().error, /workspaceDir or sessionId is required/u)

      const readResponse = await server.inject({
        method: "GET",
        url: "/api/runs/missing-run?workspaceId=ws_manifest_test",
      })
      assert.equal(readResponse.statusCode, 404)
      assert.match(readResponse.json().error, /run not found/u)
    } finally {
      await server.close()
    }
  })

  it("validates locator payloads for run patch, cancel, and retry", async () => {
    const server = await createTestServer()

    try {
      const patchResponse = await server.inject({
        method: "PATCH",
        payload: { status: "running" },
        url: "/api/runs/run-1",
      })
      assert.equal(patchResponse.statusCode, 400)
      assert.match(patchResponse.json().error, /workspaceDir or sessionId is required/u)

      const cancelResponse = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/runs/run-1/cancel",
      })
      assert.equal(cancelResponse.statusCode, 400)
      assert.match(cancelResponse.json().error, /workspaceDir or sessionId is required/u)

      const retryResponse = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/runs/run-1/retry",
      })
      assert.equal(retryResponse.statusCode, 400)
      assert.match(retryResponse.json().error, /workspaceDir or sessionId is required/u)
    } finally {
      await server.close()
    }
  })

  it("reports validation errors for non-object run bodies and mismatched workspace dirs", async () => {
    const server = await createTestServer()

    try {
      const createWithArrayBody = await server.inject({
        method: "POST",
        payload: [],
        url: "/api/runs",
      })
      assert.equal(createWithArrayBody.statusCode, 400)
      assert.match(createWithArrayBody.json().error, /workspaceDir or sessionId is required/u)

      const patchWithArrayBody = await server.inject({
        method: "PATCH",
        payload: [],
        url: "/api/runs/run-1",
      })
      assert.equal(patchWithArrayBody.statusCode, 400)
      assert.match(patchWithArrayBody.json().error, /workspaceDir or sessionId is required/u)

      const mismatchedWorkspaceDir = await server.inject({
        method: "POST",
        payload: {
          versionId: "v0001",
          workspaceDir: `${versionDir()}-other`,
        },
        url: "/api/runs",
      })
      assert.equal(mismatchedWorkspaceDir.statusCode, 400)
      assert.match(mismatchedWorkspaceDir.json().error, /workspaceDir does not match version v0001/u)
    } finally {
      await server.close()
    }
  })
})

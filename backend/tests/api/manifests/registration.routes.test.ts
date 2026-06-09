import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("manifest registration routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
  })

  it("registers artifacts, checkpoints, and scores", async () => {
    const server = await createTestServer()

    try {
      const artifactResponse = await server.inject({
        method: "POST",
        payload: {
          kind: "report",
          path: "reports/summary.md",
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/artifacts/register",
      })
      assert.equal(artifactResponse.statusCode, 200)
      const artifact = artifactResponse.json().artifact
      assert.equal(artifact.kind, "report")
      assert.equal(artifact.path, "reports/summary.md")

      const checkpointResponse = await server.inject({
        method: "POST",
        payload: {
          artifactIds: [artifact.id],
          runId: "run-1",
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/checkpoints/register",
      })
      assert.equal(checkpointResponse.statusCode, 200)
      assert.deepEqual(checkpointResponse.json().checkpoint.artifactIds, [artifact.id])

      const scoreResponse = await server.inject({
        method: "POST",
        payload: {
          metric: "quality",
          runId: "run-1",
          value: 0.95,
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/scores/register",
      })
      assert.equal(scoreResponse.statusCode, 200)
      assert.equal(scoreResponse.json().score.value, 0.95)
    } finally {
      await server.close()
    }
  })

  it("registers existing known artifacts from a version workspace", async () => {
    await fs.mkdir(path.join(versionDir(), "logs"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "progress.json"), "{}", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          workspaceId: "ws_manifest_test",
        },
        url: "/api/versions/v0001/artifacts/register-existing",
      })

      assert.equal(response.statusCode, 200)
      assert.equal(response.json().artifacts.length, 1)
      assert.equal(response.json().artifacts[0].path, "logs/progress.json")
    } finally {
      await server.close()
    }
  })

  it("reports errors when registering existing artifacts for missing versions", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          workspaceId: "ws_manifest_test",
        },
        url: "/api/versions/v_missing/artifacts/register-existing",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "version not found: v_missing" })
    } finally {
      await server.close()
    }
  })

  it("rejects absolute artifact paths and scores without numeric values", async () => {
    const server = await createTestServer()

    try {
      const artifactResponse = await server.inject({
        method: "POST",
        payload: {
          path: "/tmp/outside.md",
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/artifacts/register",
      })
      assert.equal(artifactResponse.statusCode, 400)
      assert.match(artifactResponse.json().error, /artifact path must be relative/u)

      const scoreResponse = await server.inject({
        method: "POST",
        payload: {
          metric: "quality",
          versionId: "v0001",
          workspaceId: "ws_manifest_test",
        },
        url: "/api/scores/register",
      })
      assert.equal(scoreResponse.statusCode, 400)
      assert.match(scoreResponse.json().error, /score value is required/u)
    } finally {
      await server.close()
    }
  })

  it("reports validation errors for empty or non-object registration bodies", async () => {
    const server = await createTestServer()

    try {
      const emptyArtifact = await server.inject({
        method: "POST",
        payload: {},
        url: "/api/artifacts/register",
      })
      assert.equal(emptyArtifact.statusCode, 400)
      assert.match(emptyArtifact.json().error, /workspaceDir or sessionId is required/u)

      const nonObjectCheckpoint = await server.inject({
        method: "POST",
        payload: ["not", "an", "object"],
        url: "/api/checkpoints/register",
      })
      assert.equal(nonObjectCheckpoint.statusCode, 400)
      assert.match(nonObjectCheckpoint.json().error, /workspaceDir or sessionId is required/u)

      const emptyScore = await server.inject({
        method: "POST",
        payload: null,
        url: "/api/scores/register",
      })
      assert.equal(emptyScore.statusCode, 400)
      assert.match(emptyScore.json().error, /workspaceDir or sessionId is required/u)
    } finally {
      await server.close()
    }
  })
})

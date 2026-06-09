import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("workspace model routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
    await fs.mkdir(path.join(versionDir(), "01_cad"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "01_cad", "geometry_after.glb"), Buffer.from("glb-data"))
  })

  it("resolves model metadata and serves the model file", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const modelResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${workspaceDir}`,
      })
      assert.equal(modelResponse.statusCode, 200)
      assert.match(modelResponse.json().modelUrl, /\/api\/workspace\/model\/file/u)
      assert.match(modelResponse.json().glbPath, /geometry_after\.glb$/u)

      const fileResponse = await server.inject({
        method: "GET",
        url: modelResponse.json().modelUrl,
      })
      assert.equal(fileResponse.statusCode, 200)
      assert.equal(fileResponse.headers["content-type"], "model/gltf-binary")
      assert.deepEqual(fileResponse.rawPayload, Buffer.from("glb-data"))
    } finally {
      await server.close()
    }
  })

  it("resolves models from registry manifests by run, session, variant, and direct glbPath", async () => {
    const originalGlb = path.join(versionDir(), "assembly_builds", "Doc_One", "outputs", "geometry_after.glb")
    const replacedGlb = path.join(versionDir(), "assembly_builds", "Doc_One", "outputs", "replaced.glb")
    await fs.mkdir(path.dirname(originalGlb), { recursive: true })
    await fs.writeFile(originalGlb, Buffer.from("original-glb"))
    await fs.writeFile(replacedGlb, Buffer.from("replaced-glb"))
    await fs.rm(path.join(versionDir(), "01_cad", "geometry_after.glb"))
    await fs.mkdir(path.join(versionDir(), "logs", "registry", "runs"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "index.json"), JSON.stringify({
      runs: {
        run_model_1: "runs/run_model_1.json",
      },
      sessions: {
        session_model_1: ["runs/run_model_1.json"],
      },
      version: 1,
    }), "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "runs", "run_model_1.json"), JSON.stringify({
      created_at: "2026-01-01T00:00:00.000Z",
      inputs: {
        doc_name: "Doc One",
      },
      operation: {
        status: "success",
        tool: "cad-create-assembly",
        type: "create_assembly",
      },
      outputs: {
        glb_path: path.relative(versionDir(), originalGlb),
        replaced_glb_path: path.relative(versionDir(), replacedGlb),
      },
      result: {
        document: "Doc One",
        success: true,
      },
      run_id: "run_model_1",
      session_id: "session_model_1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      updated_at: "2026-01-01T00:01:00.000Z",
      version: 1,
    }), "utf-8")
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const byRun = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${workspaceDir}&runId=run_model_1`,
      })
      assert.equal(byRun.statusCode, 200)
      assert.equal(byRun.json().runId, "run_model_1")
      assert.equal(byRun.json().sessionId, "session_model_1")
      assert.equal(byRun.json().documentName, "Doc One")
      assert.match(byRun.json().modelUrl, /runId=run_model_1/u)

      const bySession = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${workspaceDir}&sessionId=session_model_1`,
      })
      assert.equal(bySession.statusCode, 200)
      assert.equal(bySession.json().runId, "run_model_1")

      const replaced = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${workspaceDir}&runId=run_model_1&variant=replaced`,
      })
      assert.equal(replaced.statusCode, 200)
      assert.equal(replaced.json().glbPath, replacedGlb)
      assert.match(replaced.json().modelUrl, /variant=replaced/u)

      const direct = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${workspaceDir}&glbPath=${encodeURIComponent(path.relative(versionDir(), originalGlb))}`,
      })
      assert.equal(direct.statusCode, 200)
      assert.equal(direct.json().runId, null)
      assert.equal(direct.json().documentName, "geometry_after.glb")

      const fileResponse = await server.inject({
        method: "GET",
        url: replaced.json().modelUrl,
      })
      assert.equal(fileResponse.statusCode, 200)
      assert.deepEqual(fileResponse.rawPayload, Buffer.from("replaced-glb"))
    } finally {
      await server.close()
    }
  })

  it("scans registry run manifests and chooses the newest renderable model", async () => {
    await fs.rm(path.join(versionDir(), "01_cad", "geometry_after.glb"))
    const olderGlb = path.join(versionDir(), "assembly_builds", "OlderDoc", "outputs", "geometry_after.glb")
    const newerGlb = path.join(versionDir(), "assembly_builds", "Newer_Doc", "outputs", "component_info_assembly.glb")
    await fs.mkdir(path.dirname(olderGlb), { recursive: true })
    await fs.mkdir(path.dirname(newerGlb), { recursive: true })
    await fs.writeFile(olderGlb, Buffer.from("older-glb"))
    await fs.writeFile(newerGlb, Buffer.from("newer-glb"))
    await fs.mkdir(path.join(versionDir(), "logs", "registry", "runs"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "runs", "bad.json"), "{bad-json", "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "runs", "older.json"), JSON.stringify({
      created_at: "2026-01-01T00:00:00.000Z",
      inputs: { doc_name: "OlderDoc" },
      operation: {
        status: "success",
        type: "create_assembly",
      },
      result: { success: true },
      run_id: "run_older",
      session_id: "session-scan",
      updated_at: "2026-01-01T00:01:00.000Z",
    }), "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "runs", "newer.json"), JSON.stringify({
      created_at: "2026-01-01T00:02:00.000Z",
      inputs: {
        doc_name: "Newer Doc",
        input_format: "component_info_assembly",
      },
      operation: {
        status: "success",
        tool: "cad-create-assembly-from-component-info",
        type: "create_component_info_assembly",
      },
      result: {
        document: "Newer Doc",
        success: true,
      },
      run_id: "run_newer",
      session_id: "session-scan",
      updated_at: "2026-01-01T00:03:00.000Z",
    }), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.runId, "run_newer")
      assert.equal(body.sessionId, "session-scan")
      assert.equal(body.documentName, "Newer Doc")
      assert.equal(body.glbPath, newerGlb)

      const fileResponse = await server.inject({
        method: "GET",
        url: body.modelUrl,
      })
      assert.equal(fileResponse.statusCode, 200)
      assert.deepEqual(fileResponse.rawPayload, Buffer.from("newer-glb"))
    } finally {
      await server.close()
    }
  })

  it("returns 404 when no model exists", async () => {
    await fs.rm(path.join(versionDir(), "01_cad", "geometry_after.glb"))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${encodeURIComponent(versionDir())}`,
      })

      assert.equal(response.statusCode, 404)
      assert.deepEqual(response.json(), { error: "model not found" })
    } finally {
      await server.close()
    }
  })

  it("rejects model requests for workspace directories outside the request root", async () => {
    const server = await createTestServer()

    try {
      const metadataResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/model?workspaceDir=${encodeURIComponent(path.resolve("/tmp/outside-model-workspace"))}`,
      })

      assert.equal(metadataResponse.statusCode, 400)
      assert.deepEqual(metadataResponse.json(), { error: "workspaceDir must be under the workspace data root" })

      const fileResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/model/file?workspaceDir=${encodeURIComponent(path.resolve("/tmp/outside-model-workspace"))}`,
      })

      assert.equal(fileResponse.statusCode, 400)
      assert.deepEqual(fileResponse.json(), { error: "workspaceDir must be under the workspace data root" })
    } finally {
      await server.close()
    }
  })

  it("returns 404 when resolved model metadata points to a missing GLB file", async () => {
    const unreadableGlbDir = path.join(versionDir(), "01_cad", "directory.glb")
    await fs.mkdir(unreadableGlbDir, { recursive: true })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/model/file?workspaceDir=${encodeURIComponent(versionDir())}&glbPath=${encodeURIComponent("01_cad/directory.glb")}`,
      })

      assert.equal(response.statusCode, 404)
      assert.deepEqual(response.json(), { error: "glb file not found" })
    } finally {
      await server.close()
    }
  })
})

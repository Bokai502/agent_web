import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import {
  normalizeModelVariant,
  resolveModel,
  resolveProgressFromLatestSessionRun,
} from "../../../src/workspaces/workspaceRegistry.js"
import {
  createManifestFixture,
  installNoopWorkspaceCommands,
  userRoot,
  versionDir,
} from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function withWorkspaceContext<T>(callback: () => T) {
  return runWithRequestContext({
    userId: "default",
    userWorkspaceRoot: userRoot(),
    workspaceRootOverride: userRoot(),
  }, callback)
}

describe("workspace registry helpers", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
  })

  it("normalizes model variants and rejects direct model paths outside the workspace", async () => {
    await withWorkspaceContext(async () => {
      assert.equal(normalizeModelVariant("replaced"), "replaced")
      assert.equal(normalizeModelVariant("alternate"), "original")
      assert.equal(
        await resolveModel(undefined, undefined, "original", path.join(userRoot(), "..", "outside.glb"), versionDir()),
        null,
      )
      assert.equal(
        await resolveModel(undefined, undefined, "original", "00_inputs/not-a-model.step", versionDir()),
        null,
      )
    })
  })

  it("falls back to default geometry paths before scanning the registry", async () => {
    const fallbackGlb = path.join(versionDir(), "02_geometry_edit", "geometry_after.glb")
    await fs.mkdir(path.dirname(fallbackGlb), { recursive: true })
    await fs.writeFile(fallbackGlb, Buffer.from("fallback-glb"))

    await withWorkspaceContext(async () => {
      const model = await resolveModel(undefined, undefined, "original", undefined, versionDir())

      assert.equal(model?.sessionId, null)
      assert.equal(model?.runId, null)
      assert.equal(model?.documentName, "geometry_after.glb")
      assert.equal(model?.glbPath, fallbackGlb)
      assert.match(model?.version ?? "", /^glb-path:/u)
    })
  })

  it("resolves explicit GLB paths and returns null when the file is missing", async () => {
    const directGlb = path.join(versionDir(), "00_inputs", "direct.glb")
    await fs.writeFile(directGlb, Buffer.from("direct-glb"))

    await withWorkspaceContext(async () => {
      const model = await resolveModel(undefined, undefined, "original", "00_inputs/direct.glb", versionDir())
      const missing = await resolveModel(undefined, undefined, "original", "00_inputs/missing.glb", versionDir())

      assert.equal(model?.sessionId, null)
      assert.equal(model?.runId, null)
      assert.equal(model?.documentName, "direct.glb")
      assert.equal(model?.glbPath, directGlb)
      assert.match(model?.version ?? "", /^glb-path:/u)
      assert.equal(missing, null)
    })
  })

  it("reads registry manifests from a configured registry directory", async () => {
    const previousRegistryDir = process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR
    const registryDir = path.join(userRoot(), "external-registry")
    const glbPath = path.join(versionDir(), "assembly_builds", "ExternalDoc", "outputs", "geometry_after.glb")

    await fs.mkdir(path.dirname(glbPath), { recursive: true })
    await fs.writeFile(glbPath, Buffer.from("external-glb"))
    await writeJson(path.join(registryDir, "index.json"), {
      runs: {
        "run-external": "runs/run-external.json",
      },
      version: 1,
    })
    await writeJson(path.join(registryDir, "runs", "run-external.json"), {
      inputs: {
        doc_name: "ExternalDoc",
      },
      operation: {
        status: "success",
        tool: "cad-create-assembly",
      },
      run_id: "run-external",
      session_id: "session-external",
      updated_at: "2026-01-01T00:03:00.000Z",
    })

    process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR = registryDir
    try {
      await withWorkspaceContext(async () => {
        const model = await resolveModel("session-external", "run-external", "original", undefined, versionDir())

        assert.equal(model?.runId, "run-external")
        assert.equal(model?.sessionId, "session-external")
        assert.equal(model?.documentName, "ExternalDoc")
        assert.equal(model?.glbPath, glbPath)
      })
    } finally {
      if (previousRegistryDir === undefined) {
        delete process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR
      } else {
        process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR = previousRegistryDir
      }
    }
  })

  it("scans run manifests when registry indexes are missing or invalid", async () => {
    const registryRunsDir = path.join(versionDir(), "logs", "registry", "runs")
    const glbPath = path.join(versionDir(), "assembly_builds", "Indexed_Doc", "outputs", "geometry_after.glb")
    await fs.mkdir(path.dirname(glbPath), { recursive: true })
    await fs.writeFile(glbPath, Buffer.from("registry-glb"))
    await fs.mkdir(registryRunsDir, { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "registry", "index.json"), "{broken", "utf-8")
    await writeJson(path.join(registryRunsDir, "run-scanned.json"), {
      inputs: {
        doc_name: "Indexed Doc",
        output_path: "assembly_builds/Indexed_Doc/outputs/geometry_after.step",
      },
      operation: {
        status: "success",
        type: "create_assembly",
      },
      result: {
        document: "Indexed Doc",
        success: true,
      },
      run_id: "run-scanned",
      session_id: "session-scanned",
      updated_at: "2026-01-01T00:01:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const byRun = await resolveModel("session-scanned", "run-scanned", "original", undefined, versionDir())
      const bySession = await resolveModel("session-scanned", undefined, "original", undefined, versionDir())

      assert.equal(byRun?.runId, "run-scanned")
      assert.equal(byRun?.sessionId, "session-scanned")
      assert.equal(byRun?.documentName, "Indexed Doc")
      assert.equal(byRun?.glbPath, glbPath)
      assert.equal(bySession?.runId, "run-scanned")
    })
  })

  it("resolves replaced model variants from outputs, result, and artifacts", async () => {
    const registryDir = path.join(versionDir(), "logs", "registry")
    const outputGlb = path.join(versionDir(), "assembly_builds", "ReplaceDoc", "outputs", "from-output.glb")
    const resultGlb = path.join(versionDir(), "assembly_builds", "ReplaceDoc", "outputs", "from-result.glb")
    const artifactGlb = path.join(versionDir(), "assembly_builds", "ReplaceDoc", "outputs", "from-artifact.glb")

    await fs.mkdir(path.dirname(outputGlb), { recursive: true })
    await fs.writeFile(outputGlb, Buffer.from("output-replaced"))
    await fs.writeFile(resultGlb, Buffer.from("result-replaced"))
    await fs.writeFile(artifactGlb, Buffer.from("artifact-replaced"))
    await writeJson(path.join(registryDir, "index.json"), {
      runs: {
        "run-output": "runs/run-output.json",
        "run-result": "runs/run-result.json",
        "run-artifact": "runs/run-artifact.json",
      },
      version: 1,
    })
    await writeJson(path.join(registryDir, "runs", "run-output.json"), {
      outputs: {
        replaced_glb_path: path.relative(versionDir(), outputGlb),
      },
      run_id: "run-output",
      session_id: "session-replaced",
      updated_at: "2026-01-01T00:04:00.000Z",
    })
    await writeJson(path.join(registryDir, "runs", "run-result.json"), {
      result: {
        replaced_glb_path: path.relative(versionDir(), resultGlb),
      },
      run_id: "run-result",
      session_id: "session-replaced",
      updated_at: "2026-01-01T00:05:00.000Z",
    })
    await writeJson(path.join(registryDir, "runs", "run-artifact.json"), {
      artifacts: [
        {
          kind: "replaced_glb",
          path: path.relative(versionDir(), artifactGlb),
        },
      ],
      run_id: "run-artifact",
      session_id: "session-replaced",
      updated_at: "2026-01-01T00:06:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const fromOutput = await resolveModel("session-replaced", "run-output", "replaced", undefined, versionDir())
      const fromResult = await resolveModel("session-replaced", "run-result", "replaced", undefined, versionDir())
      const fromArtifact = await resolveModel("session-replaced", "run-artifact", "replaced", undefined, versionDir())

      assert.equal(fromOutput?.glbPath, outputGlb)
      assert.equal(fromResult?.glbPath, resultGlb)
      assert.equal(fromArtifact?.glbPath, artifactGlb)
      assert.match(fromArtifact?.version ?? "", /^run-artifact:replaced:/u)
    })
  })

  it("selects the latest registry model when no session or run is requested", async () => {
    const registryDir = path.join(versionDir(), "logs", "registry")
    const oldGlb = path.join(versionDir(), "assembly_builds", "OldCandidate", "outputs", "geometry_after.glb")
    const newGlb = path.join(versionDir(), "assembly_builds", "NewCandidate", "outputs", "geometry_after.glb")
    await fs.mkdir(path.dirname(oldGlb), { recursive: true })
    await fs.mkdir(path.dirname(newGlb), { recursive: true })
    await fs.writeFile(oldGlb, Buffer.from("old-candidate"))
    await fs.writeFile(newGlb, Buffer.from("new-candidate"))
    await writeJson(path.join(registryDir, "index.json"), {
      runs: {
        "run-old": "runs/run-old.json",
        "run-new": "runs/run-new.json",
      },
      version: 1,
    })
    await writeJson(path.join(registryDir, "runs", "run-old.json"), {
      outputs: {
        glb_path: path.relative(versionDir(), oldGlb),
      },
      run_id: "run-old",
      session_id: "session-old",
      updated_at: "2026-01-01T00:01:00.000Z",
    })
    await writeJson(path.join(registryDir, "runs", "run-new.json"), {
      outputs: {
        glb_path: path.relative(versionDir(), newGlb),
      },
      run_id: "run-new",
      session_id: "session-new",
      updated_at: "2026-01-01T00:02:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const model = await resolveModel(undefined, undefined, "original", undefined, versionDir())

      assert.equal(model?.runId, "run-new")
      assert.equal(model?.sessionId, "session-new")
      assert.equal(model?.glbPath, newGlb)
    })
  })

  it("resolves component-info assembly outputs from successful manifests", async () => {
    const registryDir = path.join(versionDir(), "logs", "registry")
    const glbPath = path.join(versionDir(), "assembly_builds", "Component_Doc", "outputs", "component_info_assembly.glb")
    await fs.mkdir(path.dirname(glbPath), { recursive: true })
    await fs.writeFile(glbPath, Buffer.from("component-info-glb"))
    await writeJson(path.join(registryDir, "index.json"), {
      runs: {
        "run-component": "runs/run-component.json",
      },
      version: 1,
    })
    await writeJson(path.join(registryDir, "runs", "run-component.json"), {
      inputs: {
        doc_name: "Component Doc",
        input_format: "component_info_assembly",
      },
      operation: {
        status: "success",
        tool: "cad-create-assembly",
      },
      run_id: "run-component",
      session_id: "session-component",
      updated_at: "2026-01-01T00:07:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const model = await resolveModel("session-component", "run-component", "original", undefined, versionDir())

      assert.equal(model?.runId, "run-component")
      assert.equal(model?.documentName, "Component Doc")
      assert.equal(model?.glbPath, glbPath)
    })
  })

  it("builds latest session progress from registry artifacts", async () => {
    const registryDir = path.join(versionDir(), "logs", "registry")
    const runsDir = path.join(registryDir, "runs")
    const oldGlb = path.join(versionDir(), "assembly_builds", "OldDoc", "outputs", "geometry_after.glb")
    const newStep = path.join(versionDir(), "assembly_builds", "NewDoc", "outputs", "geometry_after.step")
    await fs.mkdir(path.dirname(oldGlb), { recursive: true })
    await fs.mkdir(path.dirname(newStep), { recursive: true })
    await fs.writeFile(oldGlb, Buffer.from("old-glb"))
    await fs.writeFile(newStep, Buffer.from("new-step"))

    await writeJson(path.join(registryDir, "index.json"), {
      sessions: {
        session_progress: [
          "runs/newer.json",
          "runs/older.json",
        ],
      },
      version: 1,
    })
    await writeJson(path.join(runsDir, "older.json"), {
      artifacts: [
        { exists: true, kind: "glb", path: oldGlb },
      ],
      operation: {
        status: "success",
        tool: "cad-create-assembly",
      },
      run_id: "run-old",
      session_id: "session_progress",
      updated_at: "2026-01-01T00:01:00.000Z",
    })
    await writeJson(path.join(runsDir, "newer.json"), {
      artifacts: [
        { exists: true, kind: "step", path: newStep },
        { kind: "note", path: path.join(versionDir(), "logs", "note.txt") },
      ],
      operation: {
        status: "running",
        tool: "cad-create-assembly",
      },
      result: {
        progress_percentages: {
          export_file_percent: 25,
          modeling_percent: 75,
        },
      },
      run_id: "run-new",
      session_id: "session_progress",
      thread_id: "thread-progress",
      turn_id: "turn-progress",
      updated_at: "2026-01-01T00:02:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const progress = await resolveProgressFromLatestSessionRun("session_progress", versionDir())

      assert.equal(progress?.data.run_id, "run-old")
      assert.equal(progress?.data.thread_id, null)
      assert.equal(progress?.data.turn_id, null)
      assert.equal(progress?.data.tool, "cad-create-assembly")
      assert.equal(progress?.data.success, true)
      assert.equal(progress?.data.progress_percentages.modeling_percent, 100)
      assert.equal(progress?.data.progress_percentages.export_file_percent, 50)
      assert.equal(progress?.data.output_files.step, undefined)
      assert.deepEqual(progress?.data.output_files.glb, { exists: true, path: oldGlb })
      assert.match(progress?.sourcePath ?? "", /older\.json$/u)
      assert.match(progress?.sourceVersion ?? "", /older\.json:/u)
    })
  })
})

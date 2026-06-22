import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import {
  deleteVersion,
  getOrCreateWorkspaceManifestByLocator,
  getWorkspaceManifestSnapshotByLocator,
  resolveRunWorkspaceContext,
} from "../../../src/manifests/store.js"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import {
  createManifestFixture,
  installNoopWorkspaceCommands,
  userRoot,
  versionDir,
  workspaceRoot,
} from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

function withWorkspaceContext<T>(callback: () => T) {
  return runWithRequestContext({
    userId: "default",
    userWorkspaceRoot: userRoot(),
    workspaceRootOverride: userRoot(),
  }, callback)
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

describe("manifest store helpers", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
  })

  it("normalizes legacy manifest records and prunes missing version workspaces", async () => {
    const rootDir = workspaceRoot("ws_legacy_store")
    const keptVersionDir = versionDir("v_keep", "ws_legacy_store")
    await fs.mkdir(path.join(keptVersionDir, "00_inputs"), { recursive: true })
    await writeJson(path.join(rootDir, "workspace_manifest.json"), {
      activeVersionId: "v_missing",
      artifacts: [{ id: "artifact-ok" }, { path: "missing-id" }],
      checkpoints: [{ id: "checkpoint-ok" }, null],
      createdAt: 42,
      group: "",
      rootDir: "/old/root",
      runs: [
        { id: "run-ok", versionId: "v_keep", workspaceDir: "/old/run/workspace" },
        { status: "missing-id" },
      ],
      scores: [{ id: "score-ok" }, []],
      sessionId: "",
      versions: [
        { id: "v_keep", parentVersionId: null, status: "active", workspaceDir: "/old/workspace/v_keep" },
        { id: "v_missing", parentVersionId: null, status: "archived", workspaceDir: "/old/workspace/v_missing" },
        { id: "v_bad_parent", parentVersionId: 123, workspaceDir: keptVersionDir },
        { workspaceDir: keptVersionDir },
      ],
      workspaceId: "",
    })

    await withWorkspaceContext(async () => {
      const manifest = await getWorkspaceManifestSnapshotByLocator({ workspaceDir: keptVersionDir })

      assert.equal(manifest.workspaceId, "ws_legacy_store")
      assert.equal(manifest.sessionId, "ws_legacy_store")
      assert.equal(manifest.rootDir, rootDir)
      assert.equal(manifest.activeVersionId, null)
      assert.deepEqual(manifest.versions.map(version => version.id), ["v_keep"])
      assert.equal(manifest.versions[0]?.workspaceDir, keptVersionDir)
      assert.deepEqual(manifest.runs.map(run => run.id), ["run-ok"])
      assert.equal(manifest.runs[0]?.workspaceDir, keptVersionDir)
      assert.deepEqual(manifest.artifacts.map(artifact => artifact.id), ["artifact-ok"])
      assert.deepEqual(manifest.checkpoints.map(checkpoint => checkpoint.id), ["checkpoint-ok"])
      assert.deepEqual(manifest.scores.map(score => score.id), ["score-ok"])
    })
  })

  it("reports run workspace context mismatches", async () => {
    await createManifestFixture()

    await withWorkspaceContext(async () => {
      const contextFromRootAndVersion = await resolveRunWorkspaceContext({
        versionId: "v0001",
        workspaceDir: workspaceRoot(),
        workspaceId: "ws_manifest_test",
      })
      assert.equal(contextFromRootAndVersion.versionId, "v0001")
      assert.equal(contextFromRootAndVersion.workspaceDir, versionDir())

      const contextFromRootOnly = await resolveRunWorkspaceContext({
        workspaceDir: workspaceRoot(),
        workspaceId: "ws_manifest_test",
      })
      assert.equal(contextFromRootOnly.versionId, "v0001")
      assert.equal(contextFromRootOnly.workspaceDir, versionDir())

      await assert.rejects(
        () => resolveRunWorkspaceContext({
          workspaceDir: versionDir(),
          workspaceId: "ws_other",
        }),
        /workspaceId does not match resolved manifest/u,
      )

      await assert.rejects(
        () => resolveRunWorkspaceContext({
          versionId: "v_missing",
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        }),
        /version not found: v_missing/u,
      )

      await assert.rejects(
        () => resolveRunWorkspaceContext({
          versionId: "v0001",
          workspaceDir: path.join(workspaceRoot(), "versions", "v_other"),
          workspaceId: "ws_manifest_test",
        }),
        /workspaceDir does not match version v0001/u,
      )
    })
  })

  it("deletes versions and removes dependent manifest records", async () => {
    const { manifest, rootDir } = await createManifestFixture()
    const childDir = versionDir("v0002")
    await fs.mkdir(path.join(childDir, "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(childDir, "00_inputs", "child.txt"), "child", "utf-8")
    await writeJson(path.join(rootDir, "workspace_manifest.json"), {
      ...manifest,
      activeVersionId: "v0001",
      artifacts: [
        { id: "artifact-1", versionId: "v0001", path: "old.txt" },
        { id: "artifact-2", versionId: "v0002", path: "new.txt" },
      ],
      checkpoints: [
        { id: "checkpoint-1", versionId: "v0001" },
        { id: "checkpoint-2", versionId: "v0002" },
      ],
      runs: [
        { id: "run-1", versionId: "v0001" },
        { id: "run-2", baseVersionId: "v0001", versionId: "v0002" },
        { id: "run-3", outputVersionId: "v0001", versionId: "v0002" },
        { id: "run-4", versionId: "v0002" },
      ],
      scores: [
        { id: "score-1", versionId: "v0001" },
        { id: "score-2", versionId: "v0002" },
      ],
      versions: [
        manifest.versions[0],
        {
          createdAt: "2026-01-01T00:01:00.000Z",
          group: "test",
          id: "v0002",
          parentVersionId: "v0001",
          status: "archived",
          updatedAt: "2026-01-01T00:01:00.000Z",
          workspaceDir: childDir,
        },
      ],
    })

    await withWorkspaceContext(async () => {
      const result = await deleteVersion("v0002", { workspaceId: "ws_manifest_test" })

      assert.equal(result.versionId, "v0002")
      assert.equal(result.manifest.activeVersionId, "v0001")
      assert.deepEqual(result.manifest.versions.map(version => version.id), ["v0001"])
      assert.deepEqual(result.manifest.artifacts.map(artifact => artifact.id), ["artifact-1"])
      assert.deepEqual(result.manifest.checkpoints.map(checkpoint => checkpoint.id), ["checkpoint-1"])
      assert.deepEqual(result.manifest.runs.map(run => run.id), ["run-1"])
      assert.deepEqual(result.manifest.scores.map(score => score.id), ["score-1"])
      assert.equal(await fs.access(versionDir()).then(() => true).catch(() => false), true)
      assert.equal(await fs.access(childDir).then(() => true).catch(() => false), false)
    })
  })

  it("does not delete the initial version", async () => {
    await createManifestFixture()

    await withWorkspaceContext(async () => {
      await assert.rejects(
        () => deleteVersion("v0001", { workspaceId: "ws_manifest_test" }),
        /cannot delete the initial version/u,
      )
      assert.equal(await fs.access(versionDir()).then(() => true).catch(() => false), true)
    })
  })

  it("recovers an empty manifest from existing version directories", async () => {
    const { rootDir } = await createManifestFixture()
    await writeJson(path.join(rootDir, "workspace_manifest.json"), {
      schemaVersion: "1.0",
      workspaceId: "ws_manifest_test",
      group: "test",
      sessionId: "ws_manifest_test",
      rootDir,
      activeVersionId: null,
      versions: [],
      artifacts: [],
      checkpoints: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      runs: [],
      scores: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    })

    await withWorkspaceContext(async () => {
      const manifest = await getOrCreateWorkspaceManifestByLocator({
        sessionId: "ws_manifest_test",
        workspaceDir: rootDir,
      })

      assert.equal(manifest.activeVersionId, "v0001")
      assert.deepEqual(manifest.versions.map(version => version.id), ["v0001"])
      assert.equal(manifest.versions[0]?.status, "active")
      assert.equal(manifest.versions[0]?.workspaceDir, versionDir())
    })
  })
})

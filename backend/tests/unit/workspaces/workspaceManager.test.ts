import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { runWithRequestContext } from "../../../src/server/requestContext.js"
import {
  getWorkspaceRoot,
  listWorkspaces,
  resolveWorkspaceDir,
  setWorkspace,
} from "../../../src/workspaces/workspaceManager.js"
import {
  createManifestFixture,
  installNoopWorkspaceCommands,
  userRoot,
  versionDir,
} from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

function withWorkspaceContext<T>(callback: () => T) {
  return runWithRequestContext({
    userId: "default",
    userWorkspaceRoot: userRoot(),
    workspaceRootOverride: userRoot(),
  }, callback)
}

async function createWorkspace(name: string) {
  await fs.mkdir(path.join(userRoot(), name, "00_inputs"), { recursive: true })
}

describe("workspace manager helpers", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await fs.mkdir(userRoot(), { recursive: true })
  })

  it("uses request workspace root overrides for root and effective workspace resolution", async () => {
    await withWorkspaceContext(async () => {
      assert.equal(await getWorkspaceRoot(), userRoot())
      assert.equal(await resolveWorkspaceDir(), userRoot())
      assert.equal(await fs.access(path.join(userRoot(), "workspaces")).then(() => true).catch(() => false), true)
    })
  })

  it("ignores hidden and invalid workspaces and falls back from malformed current selection", async () => {
    await createWorkspace("alpha")
    await createWorkspace("beta")
    await fs.mkdir(path.join(userRoot(), ".hidden", "00_inputs"), { recursive: true })
    await fs.mkdir(path.join(userRoot(), "broken"), { recursive: true })
    await fs.writeFile(path.join(userRoot(), ".current-workspace.json"), "{broken", "utf-8")

    await withWorkspaceContext(async () => {
      const result = await listWorkspaces()

      assert.equal(result.root, userRoot())
      assert.equal(result.currentName, null)
      assert.equal(result.current, null)
      assert.equal(result.effective, userRoot())
      assert.deepEqual(result.items.map(item => item.name), ["alpha", "beta"])
    })
  })

  it("uses selected workspace files and persists the current workspace name", async () => {
    await createWorkspace("select_me")

    await withWorkspaceContext(async () => {
      const selected = await setWorkspace(" select_me ")

      assert.equal(selected.currentName, "select_me")
      assert.equal(selected.current, path.join(userRoot(), "select_me"))
      assert.equal(selected.item.valid, true)

      const persisted = JSON.parse(await fs.readFile(path.join(userRoot(), ".current-workspace.json"), "utf-8")) as { name?: string }
      assert.equal(persisted.name, "select_me")

      const listed = await listWorkspaces()
      assert.equal(listed.currentName, "select_me")
      assert.equal(listed.current, path.join(userRoot(), "select_me"))
    })
  })

  it("falls back to manifest roots when active version directories are missing", async () => {
    const fixture = await createManifestFixture("ws_archived_only")
    await fs.rm(versionDir("v0001", "ws_archived_only"), { force: true, recursive: true })
    await fs.writeFile(path.join(fixture.rootDir, "workspace_manifest.json"), JSON.stringify({
      ...fixture.manifest,
      activeVersionId: "v_missing",
      versions: [
        {
          ...fixture.manifest.versions[0],
          id: "v_missing",
          workspaceDir: path.join(fixture.rootDir, "versions", "v_missing"),
        },
      ],
    }), "utf-8")

    await withWorkspaceContext(async () => {
      const result = await listWorkspaces()
      const item = result.items.find(entry => entry.name === "archived_only")

      assert.equal(item?.valid, true)
      assert.equal(item?.manifestRoot, fixture.rootDir)
      assert.equal(item?.versionWorkspaceDir, undefined)
      assert.equal(item?.path, path.join(userRoot(), "archived_only"))
      assert.equal(result.current, null)
      assert.equal(result.currentName, null)
    })
  })

  it("normalizes ws_ workspace manifest directories and ignores hidden manifest roots", async () => {
    await createManifestFixture("ws_visible_manifest")
    await fs.mkdir(path.join(userRoot(), "workspaces", ".hidden_manifest", "versions", "v0001", "00_inputs"), { recursive: true })
    await fs.writeFile(path.join(userRoot(), "workspaces", ".hidden_manifest", "workspace_manifest.json"), JSON.stringify({
      activeVersionId: "v0001",
      rootDir: path.join(userRoot(), "workspaces", ".hidden_manifest"),
      versions: [
        {
          id: "v0001",
          workspaceDir: path.join(userRoot(), "workspaces", ".hidden_manifest", "versions", "v0001"),
        },
      ],
    }), "utf-8")

    await withWorkspaceContext(async () => {
      const result = await listWorkspaces()
      const item = result.items.find(entry => entry.name === "visible_manifest")

      assert.equal(item?.valid, true)
      assert.equal(item?.manifestRoot, path.join(userRoot(), "workspaces", "ws_visible_manifest"))
      assert.equal(item?.path, versionDir("v0001", "ws_visible_manifest"))
      assert.equal(result.items.some(entry => entry.name === "ws_visible_manifest"), false)
      assert.equal(result.items.some(entry => entry.name === ".hidden_manifest"), false)
    })
  })

  it("rejects unsafe workspace names and invalid selected workspaces", async () => {
    await createWorkspace("safe_workspace")
    await fs.mkdir(path.join(userRoot(), "missing_inputs"), { recursive: true })

    await withWorkspaceContext(async () => {
      await assert.rejects(
        () => setWorkspace("../escape"),
        /workspace name must be a direct child directory/u,
      )
      await assert.rejects(
        () => setWorkspace("missing_inputs"),
        /workspace is missing required files: 00_inputs/u,
      )
    })
  })
})

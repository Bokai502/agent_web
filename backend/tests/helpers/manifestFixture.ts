import fs from "node:fs/promises"
import path from "node:path"
import { TEST_DATA_ROOT } from "./resetTestData.js"

export function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

export function workspaceRoot(workspaceId = "ws_manifest_test") {
  return path.join(userRoot(), "workspaces", workspaceId)
}

export function versionDir(versionId = "v0001", workspaceId = "ws_manifest_test") {
  return path.join(workspaceRoot(workspaceId), "versions", versionId)
}

export async function installNoopWorkspaceCommands() {
  const binDir = path.join(TEST_DATA_ROOT, "bin")
  await fs.mkdir(binDir, { recursive: true })
  for (const name of ["chgrp", "chmod", "find"]) {
    const file = path.join(binDir, name)
    await fs.writeFile(file, "#!/bin/sh\nexit 0\n", "utf-8")
    await fs.chmod(file, 0o755)
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
}

export async function createManifestFixture(workspaceId = "ws_manifest_test") {
  const rootDir = workspaceRoot(workspaceId)
  const firstVersionDir = versionDir("v0001", workspaceId)
  await fs.mkdir(path.join(firstVersionDir, "00_inputs"), { recursive: true })
  await fs.writeFile(path.join(firstVersionDir, "00_inputs", "input.txt"), "initial", "utf-8")

  const now = "2026-01-01T00:00:00.000Z"
  const manifest = {
    activeVersionId: "v0001",
    artifacts: [],
    checkpoints: [],
    createdAt: now,
    group: "test",
    rootDir,
    runs: [],
    schemaVersion: "1.0",
    scores: [],
    sessionId: workspaceId,
    updatedAt: now,
    versions: [
      {
        createdAt: now,
        group: "test",
        id: "v0001",
        parentVersionId: null,
        status: "active",
        updatedAt: now,
        workspaceDir: firstVersionDir,
      },
    ],
    workspaceId,
  }
  await fs.writeFile(path.join(rootDir, "workspace_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8")
  return { firstVersionDir, manifest, rootDir, workspaceId }
}

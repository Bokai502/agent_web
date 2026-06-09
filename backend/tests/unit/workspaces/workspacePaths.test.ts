import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import {
  resolveUsersRootFromConfig,
  resolveUserWorkspaceRoot,
  resolveWorkspaceTemplateRoot,
} from "../../../src/workspaces/workspacePaths.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("workspace path helpers", () => {
  it("resolves explicit template roots and relative workspace users roots", () => {
    const templateDir = path.resolve("/tmp/codex-template")
    const config = createTestConfig({
      workspace: {
        templateDir,
        usersRoot: "relative-users",
      },
    })

    assert.equal(resolveWorkspaceTemplateRoot(config), templateDir)
    assert.equal(resolveUsersRootFromConfig(config), path.join(templateDir, "relative-users"))
    assert.equal(resolveUserWorkspaceRoot(config, "alice"), path.join(templateDir, "relative-users", "alice"))
  })

  it("prefers absolute workspace users roots over auth users dirs", () => {
    const usersRoot = path.resolve("/tmp/codex-users")
    const config = createTestConfig({
      auth: {
        usersDir: path.resolve("/tmp/auth-users"),
      },
      workspace: {
        templateDir: path.resolve("/tmp/templates"),
        usersRoot,
      },
    })

    assert.equal(resolveUsersRootFromConfig(config), usersRoot)
  })

  it("falls back to auth users dirs and the default template root", () => {
    const config = createTestConfig({
      auth: {
        usersDir: "auth-users",
      },
      workspace: {
        templateDir: null as never,
        usersRoot: null as never,
      },
    })
    const defaultTemplateRoot = path.resolve(process.cwd(), "..", "data", "input_data")

    assert.equal(resolveWorkspaceTemplateRoot(config), defaultTemplateRoot)
    assert.equal(resolveUsersRootFromConfig(config), path.join(defaultTemplateRoot, "auth-users"))
  })
})

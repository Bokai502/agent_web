import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("remote tools routes", () => {
  it("reports functional interface status from the port-status compatibility route", async () => {
    const server = await createTestServer({ config: createTestConfig() })

    try {
      const response = await server.inject({ method: "GET", url: "/api/remote-tools/port-status" })
      const body = response.json()

      assert.equal(response.statusCode, body.ok ? 200 : 503)
      assert.equal(typeof body.ok, "boolean")
      assert.equal(typeof body.checkedAt, "string")
      assert.equal(body.cacheTtlMs, 0)
      assert.equal(path.basename(body.command.at(-2)), "check_function_interfaces.mjs")
      assert.equal(body.command.at(-1), "--json")
      assert.equal(Array.isArray(body.results), true)
      assert.equal(typeof body.requiredFailureCount, "number")
      assert.equal(typeof body.optionalFailureCount, "number")
      assert.equal(typeof body.skippedCount, "number")
    } finally {
      await server.close()
    }
  })

  it("reports functional interface status from the interface-status route", async () => {
    const server = await createTestServer({ config: createTestConfig() })

    try {
      const response = await server.inject({ method: "GET", url: "/api/remote-tools/interface-status" })
      const body = response.json()

      assert.equal(response.statusCode, body.ok ? 200 : 503)
      assert.equal(typeof body.ok, "boolean")
      assert.equal(Array.isArray(body.results), true)
      for (const result of body.results as Array<Record<string, unknown>>) {
        assert.equal(typeof result.group, "string")
        assert.equal(typeof result.name, "string")
        assert.equal(typeof result.target, "string")
        assert.equal(typeof result.required, "boolean")
        assert.equal(typeof result.ok, "boolean")
        assert.equal(typeof result.skipped, "boolean")
        assert.equal(typeof result.durationMs, "number")
      }
    } finally {
      await server.close()
    }
  })

  it("launches configured remote desktop tools", async () => {
    const config = createTestConfig({
      tools: {
        comsol: {
          launcher: "/bin/true",
          sudo: "",
        },
        remoteDesktopLauncher: "/bin/true",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "POST", url: "/api/remote-tools/ensure-desktops" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.ok, true)
      assert.deepEqual(body.results.map((result: { tool: string }) => result.tool), ["freecad", "paraview", "comsol"])
      assert.equal(body.results.every((result: { ok: boolean; code: number }) => result.ok && result.code === 0), true)
      assert.deepEqual(body.results[0].command, ["/bin/true", "freecad", "start"])
      assert.deepEqual(body.results[2].command, ["/bin/true"])
    } finally {
      await server.close()
    }
  })

  it("uses the configured sudo command for COMSOL launch", async () => {
    const config = createTestConfig({
      tools: {
        comsol: {
          launcher: "comsol-launcher",
          sudo: "/bin/true",
        },
        remoteDesktopLauncher: "/bin/true",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "POST", url: "/api/remote-tools/ensure-desktops" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.ok, true)
      assert.deepEqual(body.results[2].command, ["/bin/true", "comsol-launcher"])
    } finally {
      await server.close()
    }
  })

  it("returns 503 when a launcher fails", async () => {
    const server = await createTestServer({
      config: createTestConfig({
        tools: {
          comsol: {
            launcher: "/bin/false",
            sudo: "",
          },
          remoteDesktopLauncher: "/bin/false",
        },
      }),
    })

    try {
      const response = await server.inject({ method: "POST", url: "/api/remote-tools/ensure-desktops" })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.equal(body.ok, false)
      assert.equal(body.results.every((result: { ok: boolean; code: number }) => !result.ok && result.code === 1), true)
    } finally {
      await server.close()
    }
  })

  it("returns launcher stdout and stderr for mixed launch results", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-remote-tools-"))
    const launcher = path.join(tmpDir, "launcher.sh")
    await fs.writeFile(launcher, [
      "#!/bin/sh",
      "echo \"stdout:$1:$2\"",
      "echo \"stderr:$1:$2\" >&2",
      "if [ -z \"$1\" ]; then exit 7; fi",
      "exit 0",
      "",
    ].join("\n"), "utf-8")
    await fs.chmod(launcher, 0o755)
    const server = await createTestServer({
      config: createTestConfig({
        tools: {
          comsol: {
            launcher,
            sudo: "",
          },
          remoteDesktopLauncher: launcher,
        },
      }),
    })

    try {
      const response = await server.inject({ method: "POST", url: "/api/remote-tools/ensure-desktops" })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.equal(body.ok, false)
      assert.deepEqual(body.results.map((result: { ok: boolean }) => result.ok), [true, true, false])
      assert.deepEqual(body.results[0].command, [launcher, "freecad", "start"])
      assert.equal(body.results[0].stdout, "stdout:freecad:start\n")
      assert.equal(body.results[0].stderr, "stderr:freecad:start\n")
      assert.deepEqual(body.results[2].command, [launcher])
      assert.equal(body.results[2].code, 7)
      assert.equal(body.results[2].stdout, "stdout::\n")
      assert.equal(body.results[2].stderr, "stderr::\n")
    } finally {
      await server.close()
      await fs.rm(tmpDir, { force: true, recursive: true })
    }
  })

  it("returns launcher spawn errors when a configured command is missing", async () => {
    const missingLauncher = "/tmp/open-codex-web-missing-launcher"
    const server = await createTestServer({
      config: createTestConfig({
        tools: {
          comsol: {
            launcher: missingLauncher,
            sudo: "",
          },
          remoteDesktopLauncher: missingLauncher,
        },
      }),
    })

    try {
      const response = await server.inject({ method: "POST", url: "/api/remote-tools/ensure-desktops" })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.equal(body.ok, false)
      assert.equal(body.results.every((result: { code: number | null; error?: string; ok: boolean }) =>
        !result.ok && result.code === null && typeof result.error === "string"
      ), true)
    } finally {
      await server.close()
    }
  })
})

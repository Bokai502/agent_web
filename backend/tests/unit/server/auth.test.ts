import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { buildUserCookie, resolveRequestUser, resolveUsersRoot, sanitizeUserId } from "../../../src/server/auth.js"
import { TEST_DATA_ROOT } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

function request(headers: Record<string, string | string[] | undefined>) {
  return { headers } as never
}

describe("server auth helpers", () => {
  it("sanitizes blank, unsafe, and overlong user ids", () => {
    assert.equal(sanitizeUserId(null, "fallback"), "fallback")
    assert.equal(sanitizeUserId("  ../Alice Smith!  ", "fallback"), ".._Alice_Smith")
    assert.equal(sanitizeUserId("!".repeat(4), "fallback"), "fallback")
    assert.equal(sanitizeUserId("a".repeat(120), "fallback"), "a".repeat(96))
  })

  it("resolves users root and request users from headers, cookies, and fallbacks", () => {
    const usersRoot = path.join(TEST_DATA_ROOT, "custom-users")
    const config = createTestConfig({
      auth: {
        cookieName: "codex_user_id",
        devUserId: "dev-user",
        headerName: "x-codex-user-id",
        usersDir: usersRoot,
      },
      workspace: {
        usersRoot,
      },
    })

    assert.equal(resolveUsersRoot(config), usersRoot)

    const headerUser = resolveRequestUser(
      request({ "x-codex-user-id": [" Header User! ", "ignored"], cookie: "codex_user_id=cookie-user" }),
      config,
      "/unused",
    )
    assert.equal(headerUser.authenticated, true)
    assert.equal(headerUser.userId, "Header_User")
    assert.equal(headerUser.workspaceRoot, path.join(usersRoot, "Header_User"))

    const cookieUser = resolveRequestUser(
      request({ cookie: "other=1; codex_user_id=Cookie%20User%21; theme=dark" }),
      config,
      "/unused",
    )
    assert.equal(cookieUser.authenticated, true)
    assert.equal(cookieUser.userId, "Cookie_User")
    assert.equal(cookieUser.workspaceRoot, path.join(usersRoot, "Cookie_User"))

    const fallbackUser = resolveRequestUser(request({}), config, "/unused")
    assert.equal(fallbackUser.authenticated, false)
    assert.equal(fallbackUser.userId, "dev-user")
    assert.equal(fallbackUser.workspaceRoot, path.join(usersRoot, "dev-user"))
  })

  it("requires explicit credentials when auth is enabled and preserves malformed cookie values", () => {
    const config = createTestConfig({
      auth: {
        devUserId: "default-user",
        enabled: true,
      },
    })

    const anonymous = resolveRequestUser(request({}), config, "/unused")
    assert.equal(anonymous.authenticated, false)
    assert.equal(anonymous.userId, "default-user")

    const malformedCookie = resolveRequestUser(
      request({ cookie: "codex_user_id=%E0%A4%A" }),
      config,
      "/unused",
    )
    assert.equal(malformedCookie.authenticated, true)
    assert.equal(malformedCookie.userId, "E0_A4_A")
  })

  it("builds a sanitized persistent user cookie", () => {
    const config = createTestConfig({
      auth: {
        cookieName: "codex_user_id",
        devUserId: "default-user",
      },
    })

    assert.equal(
      buildUserCookie(config, "../Alice Smith!"),
      "codex_user_id=.._Alice_Smith; Path=/; SameSite=Lax; Max-Age=31536000",
    )
  })
})

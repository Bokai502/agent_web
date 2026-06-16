import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveModelBackend } from "../../../src/modelBackends/modelBackends.js"
import { RunRequestError } from "../../../src/codex-run/runErrors.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("resolveModelBackend", () => {
  it("defaults to chatModel", () => {
    const backend = resolveModelBackend(createTestConfig())

    assert.equal(backend.id, "chatModel")
    assert.equal(backend.apiKey, "test-chat-api-key")
    assert.equal(backend.model, "test-chat-model")
  })

  it("resolves the original openai config when requested", () => {
    const backend = resolveModelBackend(createTestConfig(), "openai")

    assert.equal(backend.id, "openai")
    assert.equal(backend.apiKey, "test-openai-api-key")
    assert.equal(backend.model, "test-openai-model")
  })

  it("rejects invalid model backend names", () => {
    assert.throws(
      () => resolveModelBackend(createTestConfig(), "local"),
      (err: unknown) => err instanceof RunRequestError && err.statusCode === 400,
    )
  })
})


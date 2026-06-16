import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildCodexConfig, getCodexBaseUrl } from "../../../src/codex-run/codexConfig.js"
import { resolveModelBackend } from "../../../src/modelBackends/modelBackends.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("buildCodexConfig", () => {
  it("builds the minimal Codex config", () => {
    assert.deepEqual(buildCodexConfig(createTestConfig()), {
      show_raw_agent_reasoning: true,
    })
  })

  it("includes workspace-write network access and chatModel provider metadata", () => {
    const config = createTestConfig({
      codex: {
        sandboxWorkspaceWriteNetworkAccess: true,
      },
      chatModel: {
        baseUrl: "https://api.example.test/v1",
        modelProvider: "example",
        modelProviderName: "Example Provider",
        responsesCompat: false,
        supportsWebsockets: false,
        wireApi: "responses",
      },
    })

    assert.deepEqual(buildCodexConfig(config), {
      model_provider: "example",
      model_providers: {
        example: {
          base_url: "https://api.example.test/v1",
          name: "Example Provider",
          supports_websockets: false,
          wire_api: "responses",
        },
      },
      sandbox_workspace_write: {
        network_access: true,
      },
      show_raw_agent_reasoning: true,
    })
  })

  it("uses the local Responses compatibility endpoint by default for non-OpenAI Responses providers", () => {
    const config = createTestConfig({
      chatModel: {
        baseUrl: "https://api.example.test/v1",
        modelProvider: "example",
        responsesCompat: null,
        wireApi: "responses",
      },
      server: {
        port: 3002,
      },
    })

    assert.equal(getCodexBaseUrl(config), "http://127.0.0.1:3002/internal/codex/v1")
    assert.deepEqual(buildCodexConfig(config), {
      model_provider: "example",
      model_providers: {
        example: {
          base_url: "http://127.0.0.1:3002/internal/codex/v1",
          name: "example",
          wire_api: "responses",
        },
      },
      show_raw_agent_reasoning: true,
    })
  })

  it("falls back to provider ids and omits optional provider fields", () => {
    const config = createTestConfig({
      chatModel: {
        modelProvider: "minimal-provider",
        modelProviderName: null,
        supportsWebsockets: null,
        wireApi: null,
      },
    })

    assert.deepEqual(buildCodexConfig(config), {
      model_provider: "minimal-provider",
      model_providers: {
        "minimal-provider": {
          base_url: "http://127.0.0.1:9",
          name: "minimal-provider",
        },
      },
      show_raw_agent_reasoning: true,
    })
  })

  it("uses the original OpenAI endpoint without overriding the built-in provider", () => {
    const config = createTestConfig({
      openai: {
        baseUrl: "https://api.openai.test/v1",
        modelProvider: "openai",
        modelProviderName: "OpenAI",
        supportsWebsockets: true,
        wireApi: "responses",
      },
      server: {
        port: 3002,
      },
    })
    const backend = resolveModelBackend(config, "openai")

    assert.equal(getCodexBaseUrl(config, backend), "https://api.openai.test/v1")
    assert.deepEqual(buildCodexConfig(config, backend), {
      show_raw_agent_reasoning: true,
    })
  })
})

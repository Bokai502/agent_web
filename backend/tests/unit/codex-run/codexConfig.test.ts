import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildCodexConfig } from "../../../src/codex-run/codexConfig.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("buildCodexConfig", () => {
  it("builds the minimal Codex config", () => {
    assert.deepEqual(buildCodexConfig(createTestConfig()), {
      show_raw_agent_reasoning: true,
    })
  })

  it("includes workspace-write network access and OpenAI provider metadata", () => {
    const config = createTestConfig({
      codex: {
        sandboxWorkspaceWriteNetworkAccess: true,
      },
      openai: {
        baseUrl: "https://api.example.test/v1",
        modelProvider: "example",
        modelProviderName: "Example Provider",
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

  it("falls back to provider ids and omits optional provider fields", () => {
    const config = createTestConfig({
      openai: {
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
})

import type { AppConfig } from "../config.js"

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject
type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

export function buildCodexConfig(config: AppConfig): CodexConfigObject {
  const codexConfig: CodexConfigObject = {
    show_raw_agent_reasoning: true,
  }

  if (config.codex.sandboxWorkspaceWriteNetworkAccess) {
    codexConfig.sandbox_workspace_write = {
      network_access: true,
    }
  }

  const providerId = config.openai.modelProvider
  if (providerId) {
    codexConfig.model_provider = providerId
    codexConfig.model_providers = {
      [providerId]: {
        name: config.openai.modelProviderName ?? providerId,
        base_url: config.openai.baseUrl,
        ...(config.openai.wireApi ? { wire_api: config.openai.wireApi } : {}),
        ...(config.openai.supportsWebsockets == null
          ? {}
          : { supports_websockets: config.openai.supportsWebsockets }),
      },
    }
  }

  return codexConfig
}

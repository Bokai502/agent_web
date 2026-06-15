import type { AppConfig } from "../config.js"
import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject
type CodexConfigObject = {
  [key: string]: CodexConfigValue
}

function shouldUseResponsesCompat(backend: ResolvedModelBackend) {
  if (backend.id !== "chatModel") return false
  if (backend.responsesCompat != null) return backend.responsesCompat
  return backend.wireApi === "responses" && backend.modelProvider !== "openai"
}

export function getCodexBaseUrl(config: AppConfig, backend: ResolvedModelBackend = resolveModelBackend(config)) {
  if (!shouldUseResponsesCompat(backend)) return backend.baseUrl
  return `http://127.0.0.1:${config.server.port}/internal/codex/v1`
}

export function buildCodexConfig(config: AppConfig, backend: ResolvedModelBackend = resolveModelBackend(config)): CodexConfigObject {
  const codexConfig: CodexConfigObject = {
    show_raw_agent_reasoning: true,
  }

  if (config.codex.sandboxWorkspaceWriteNetworkAccess) {
    codexConfig.sandbox_workspace_write = {
      network_access: true,
    }
  }

  const providerId = backend.id === "openai" && backend.modelProvider === "openai"
    ? null
    : backend.modelProvider
  if (providerId) {
    codexConfig.model_provider = providerId
    codexConfig.model_providers = {
      [providerId]: {
        name: backend.modelProviderName ?? providerId,
        base_url: getCodexBaseUrl(config, backend),
        ...(backend.wireApi ? { wire_api: backend.wireApi } : {}),
        ...(backend.supportsWebsockets == null
          ? {}
          : { supports_websockets: backend.supportsWebsockets }),
      },
    }
  }

  return codexConfig
}

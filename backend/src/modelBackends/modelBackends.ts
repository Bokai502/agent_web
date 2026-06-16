import type { AppConfig } from "../config.js"
import { RunRequestError } from "../codex-run/runErrors.js"

export type ModelBackend = "openai" | "chatModel"

export type ResolvedModelBackend = {
  apiKey: string
  approvalPolicy: AppConfig["codex"]["approvalPolicy"]
  baseUrl: string
  id: ModelBackend
  model: string | null
  modelProvider: string | null
  modelProviderName: string | null
  modelReasoningEffort: AppConfig["codex"]["modelReasoningEffort"]
  responsesCompat: boolean | null
  sandboxMode: AppConfig["codex"]["sandboxMode"]
  skipGitRepoCheck: boolean
  supportsWebsockets: boolean | null
  wireApi: string | null
}

export const DEFAULT_MODEL_BACKEND: ModelBackend = "chatModel"

export function parseModelBackend(value: unknown): ModelBackend {
  if (value == null) return DEFAULT_MODEL_BACKEND
  if (value === "openai" || value === "chatModel") return value
  throw new RunRequestError(400, "modelBackend must be one of: openai, chatModel")
}

export function resolveModelBackend(config: AppConfig, requested?: unknown): ResolvedModelBackend {
  const id = parseModelBackend(requested)
  if (id === "openai") {
    return {
      apiKey: config.openai.apiKey,
      approvalPolicy: config.codex.approvalPolicy,
      baseUrl: config.openai.baseUrl,
      id,
      model: config.openai.model,
      modelProvider: config.openai.modelProvider,
      modelProviderName: config.openai.modelProviderName,
      modelReasoningEffort: config.codex.modelReasoningEffort,
      responsesCompat: null,
      sandboxMode: config.codex.sandboxMode,
      skipGitRepoCheck: config.codex.skipGitRepoCheck,
      supportsWebsockets: config.openai.supportsWebsockets,
      wireApi: config.openai.wireApi,
    }
  }

  return {
    apiKey: config.chatModel.apiKey,
    approvalPolicy: config.chatModel.approvalPolicy,
    baseUrl: config.chatModel.baseUrl,
    id,
    model: config.chatModel.model,
    modelProvider: config.chatModel.modelProvider,
    modelProviderName: config.chatModel.modelProviderName,
    modelReasoningEffort: config.chatModel.modelReasoningEffort,
    responsesCompat: config.chatModel.responsesCompat,
    sandboxMode: config.chatModel.sandboxMode,
    skipGitRepoCheck: config.chatModel.skipGitRepoCheck,
    supportsWebsockets: config.chatModel.supportsWebsockets,
    wireApi: config.chatModel.wireApi,
  }
}

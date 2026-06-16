import type { UserInput } from "@openai/codex-sdk"

export interface RunContext {
  workspaceDir: string | null
  workspaceId: string | null
  sessionId: string
  threadId: string | null
  turnId: string
  versionId: string | null
}

export type RunInputItem = UserInput

export interface RunRequestBody {
  prompt?: string | null
  input?: unknown
  inputType?: "text" | "voice"
  modelBackend?: "openai" | "chatModel"
  sessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  enabledSkills?: string[]
  versionId?: string | null
  workspaceDir?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
}

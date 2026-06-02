import { Codex } from "@openai/codex-sdk"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { buildCodexConfig } from "../codex-run/codexConfig.js"

type RunVoiceTextWithCodexResult = {
  responseText: string
  elapsedMs: number
}

function getFinalResponse(turn: unknown) {
  if (turn && typeof turn === "object" && "finalResponse" in turn) {
    const response = (turn as { finalResponse?: unknown }).finalResponse
    return typeof response === "string" ? response.trim() : ""
  }

  return ""
}

export async function runVoiceTextWithCodex(
  transcript: string,
  { config, logger, requestId }: { config: AppConfig; logger: Logger; requestId: string },
): Promise<RunVoiceTextWithCodexResult> {
  const prompt = transcript.trim()
  if (!prompt) return { responseText: "", elapsedMs: 0 }

  const startedAt = process.hrtime.bigint()
  const codex = new Codex({
    apiKey: config.openai.apiKey,
    baseUrl: config.openai.baseUrl,
    config: buildCodexConfig(config),
  })

  const thread = codex.startThread({
    ...(config.openai.model ? { model: config.openai.model } : {}),
    workingDirectory: config.codex.workingDirectory,
    approvalPolicy: config.codex.approvalPolicy,
    skipGitRepoCheck: config.codex.skipGitRepoCheck,
    modelReasoningEffort: config.codex.modelReasoningEffort,
    sandboxMode: config.codex.sandboxMode,
  })

  logger.info("whisper codex task started", {
    requestId,
    promptChars: prompt.length,
    model: config.openai.model,
    workingDirectory: config.codex.workingDirectory,
  })

  const turn = await thread.run(prompt)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
  const responseText = getFinalResponse(turn)

  logger.info("whisper codex task completed", {
    requestId,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    responseChars: responseText.length,
  })

  return { responseText, elapsedMs }
}

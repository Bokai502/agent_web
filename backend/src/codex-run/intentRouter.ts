import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { readRoutingSkillInstruction, type SkillScope } from "../system/skills.js"
import { normalizeRunInput } from "./runInput.js"
import type { RunRequestBody } from "./runTypes.js"

export type RoutedIntent = "thermal" | "gnc" | "general"
export type ManagedSkill = "task-runner" | "progress-summarizer"

export type IntentRoutingResult = {
  intent: RoutedIntent
  managedSkills: ManagedSkill[]
  selectedSkills: string[]
  skillScopes: SkillScope[]
  source: "codex" | "fallback"
}

const INTENT_ROUTER_MODEL = process.env.CODEX_INTENT_ROUTER_MODEL?.trim() || "gpt-5.5"
const INTENT_ROUTER_TIMEOUT_MS = Number(process.env.CODEX_INTENT_ROUTER_TIMEOUT_MS ?? 8_000)

function getInputText(body: RunRequestBody) {
  const input = normalizeRunInput(body.input, body.prompt)
  if (!input) return ""
  return input
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("\n\n")
    .trim()
}

function fallbackRouting(): IntentRoutingResult {
  return {
    intent: "general",
    managedSkills: ["task-runner"],
    selectedSkills: [],
    skillScopes: ["public"],
    source: "fallback",
  }
}

function uniqueSkills(skills: string[]) {
  return [...new Set(skills.map(skill => skill.trim()).filter(Boolean))]
}

function normalizeSkillScopes(value: unknown): SkillScope[] | null {
  if (!Array.isArray(value)) return null
  const scopes = value.filter((item): item is SkillScope =>
    item === "public" || item === "thermal" || item === "aignc"
  )
  if (scopes.length !== value.length || !scopes.includes("public")) return null
  const uniqueScopes = [...new Set(scopes)]
  if (uniqueScopes.includes("thermal") && uniqueScopes.includes("aignc")) return null
  if (uniqueScopes.length > 2) return null
  return uniqueScopes
}

function getIntentFromScopes(scopes: SkillScope[]): RoutedIntent {
  if (scopes.includes("thermal")) return "thermal"
  if (scopes.includes("aignc")) return "gnc"
  return "general"
}

function normalizeManagedSkills(value: unknown): ManagedSkill[] | null {
  if (!Array.isArray(value)) return ["task-runner"]
  const skills = value.filter((item): item is ManagedSkill =>
    item === "task-runner" || item === "progress-summarizer"
  )
  if (skills.length !== value.length || skills.length === 0) return null
  const uniqueSkills = [...new Set(skills)]
  if (uniqueSkills.length !== 1) return null
  return uniqueSkills
}

function parseRoutingJson(text: string): IntentRoutingResult | null {
  const match = text.match(/\{[\s\S]*\}/u)
  if (!match) return null
  const parsed = JSON.parse(match[0]) as {
    managedSkills?: unknown
    selectedSkills?: unknown
    skillScopes?: unknown
  }
  const scopes = normalizeSkillScopes(parsed.skillScopes)
  const managedSkills = normalizeManagedSkills(parsed.managedSkills)
  if (!managedSkills) return null
  if (!scopes) return null
  const selectedSkills = Array.isArray(parsed.selectedSkills)
    ? parsed.selectedSkills.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : []
  return {
    intent: getIntentFromScopes(scopes),
    managedSkills,
    selectedSkills: uniqueSkills(selectedSkills),
    skillScopes: scopes,
    source: "codex",
  }
}

function getResponseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return ""
  const outputText = (payload as { output_text?: unknown }).output_text
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim()

  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return ""
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue
      const text = (contentItem as { text?: unknown }).text
      if (typeof text === "string" && text.trim()) parts.push(text.trim())
    }
  }
  return parts.join("\n").trim()
}

async function createRoutingResponse({
  config,
  logger,
  prompt,
  requestId,
  signal,
}: {
  config: AppConfig
  logger: Logger
  prompt: string
  requestId?: string
  signal: AbortSignal
}) {
  const baseUrl = config.openai.baseUrl.replace(/\/+$/u, "")
  const startedAt = process.hrtime.bigint()
  logger.info("responses api request started", {
    apiKind: "responses",
    apiRoute: "/responses",
    maxOutputTokens: 220,
    model: INTENT_ROUTER_MODEL,
    promptLength: prompt.length,
    purpose: "managed-intent-routing",
    requestId,
  })
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: prompt.slice(0, 12_000),
      max_output_tokens: 220,
      model: INTENT_ROUTER_MODEL,
    }),
    signal,
  })
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    logger.warn("responses api request failed", {
      apiKind: "responses",
      apiRoute: "/responses",
      latencyMs,
      model: INTENT_ROUTER_MODEL,
      purpose: "managed-intent-routing",
      requestId,
      status: response.status,
    })
    throw new Error(`responses api failed: HTTP ${response.status}${body ? `\n${body.slice(0, 1000)}` : ""}`)
  }

  const payload = await response.json() as unknown
  const outputText = getResponseOutputText(payload)
  logger.info("responses api request completed", {
    apiKind: "responses",
    apiRoute: "/responses",
    latencyMs,
    model: INTENT_ROUTER_MODEL,
    outputLength: outputText.length,
    purpose: "managed-intent-routing",
    requestId,
    status: response.status,
  })
  return outputText
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout()
          reject(new Error(`operation timed out after ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function routeManagedRunIntent(
  body: RunRequestBody,
  { config, logger, requestId }: { config: AppConfig; logger: Logger; requestId?: string },
): Promise<IntentRoutingResult> {
  const userInput = getInputText(body)
  if (!userInput) return fallbackRouting()

  const skill = readRoutingSkillInstruction("intent-router")
  if (!skill) return fallbackRouting()

  try {
    const abort = new AbortController()
    const prompt = [
      skill.content.trim(),
      "",
      "Classify this user request. Return only strict JSON.",
      "",
      userInput,
    ].join("\n")
    const responseText = await withTimeout(
      createRoutingResponse({
        config,
        logger,
        prompt,
        requestId,
        signal: abort.signal,
      }),
      INTENT_ROUTER_TIMEOUT_MS,
      () => abort.abort(),
    )
    const parsed = parseRoutingJson(responseText)
    if (parsed) {
      logger.info("managed run intent routed", {
        intent: parsed.intent,
        model: INTENT_ROUTER_MODEL,
        managedSkills: parsed.managedSkills,
        requestId,
        selectedSkills: parsed.selectedSkills,
        skillScopes: parsed.skillScopes,
        source: parsed.source,
        timeoutMs: INTENT_ROUTER_TIMEOUT_MS,
      })
      return parsed
    }
  } catch (err) {
    logger.warn("managed run intent routing fallback", { err, requestId })
  }

  const fallback = fallbackRouting()
  logger.info("managed run intent routed", {
    intent: fallback.intent,
    model: INTENT_ROUTER_MODEL,
    managedSkills: fallback.managedSkills,
    requestId,
    selectedSkills: fallback.selectedSkills,
    skillScopes: fallback.skillScopes,
    source: fallback.source,
    timeoutMs: INTENT_ROUTER_TIMEOUT_MS,
  })
  return fallback
}

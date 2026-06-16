import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

type RewriteStats = {
  droppedInstructions: boolean
  developerRolesRewritten: number
  filteredTools: string[]
  compactedInputItems: number
  modelOverriddenFrom: string | null
  proactiveCompact: boolean
  strippedTopLevelFields: string[]
  systemMessagesMerged: number
  systemMessagesMoved: number
}

type RequestShape = {
  contentTypes: Record<string, number>
  hasPreviousResponseId: boolean
  inputItems: number | null
  inputRoles: Record<string, number>
  inputTypes: Record<string, number>
  jsonBytes: number | null
  model: string | null
  toolCount: number | null
  toolNames: string[]
  toolTypes: Record<string, number>
  topLevelKeys: string[]
}

const COMPAT_STRIPPED_TOP_LEVEL_FIELDS = [
  "client_metadata",
  "include",
  "metadata",
  "parallel_tool_calls",
  "prompt_cache_key",
  "reasoning",
  "store",
  "tool_choice",
  "truncation",
]

const FAILURE_BODY_PREVIEW_BYTES = 1200
const PROACTIVE_COMPACT_JSON_BYTES = 90 * 1024
const PROACTIVE_COMPACT_INPUT_ITEMS = 18
const PROACTIVE_COMPACT_FUNCTION_OUTPUTS = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function emptyStats(): RewriteStats {
  return {
    compactedInputItems: 0,
    developerRolesRewritten: 0,
    droppedInstructions: false,
    filteredTools: [],
    modelOverriddenFrom: null,
    proactiveCompact: false,
    strippedTopLevelFields: [],
    systemMessagesMerged: 0,
    systemMessagesMoved: 0,
  }
}

function incrementCounter(counter: Record<string, number>, key: unknown) {
  const normalized = typeof key === "string" && key.trim() ? key : "<missing>"
  counter[normalized] = (counter[normalized] ?? 0) + 1
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim()
}

function previewBuffer(buffer: Buffer) {
  if (buffer.length === 0) return null
  return compactWhitespace(buffer.subarray(0, FAILURE_BODY_PREVIEW_BYTES).toString("utf-8"))
}

function jsonByteLength(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return null
  }
}

export function summarizeResponsesRequestShape(body: unknown): RequestShape {
  if (!isRecord(body)) {
    return {
      contentTypes: {},
      hasPreviousResponseId: false,
      inputItems: null,
      inputRoles: {},
      inputTypes: {},
      jsonBytes: jsonByteLength(body),
      model: null,
      toolCount: null,
      toolNames: [],
      toolTypes: {},
      topLevelKeys: [],
    }
  }

  const contentTypes: Record<string, number> = {}
  const inputRoles: Record<string, number> = {}
  const inputTypes: Record<string, number> = {}
  const toolTypes: Record<string, number> = {}
  const tools = Array.isArray(body.tools) ? body.tools : null
  const input = Array.isArray(body.input) ? body.input : null

  if (input) {
    for (const item of input) {
      if (!isRecord(item)) {
        incrementCounter(inputTypes, typeof item)
        continue
      }
      incrementCounter(inputTypes, item.type)
      incrementCounter(inputRoles, item.role)
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          incrementCounter(contentTypes, isRecord(content) ? content.type : typeof content)
        }
      }
    }
  }

  const toolNames: string[] = []
  if (tools) {
    for (const tool of tools) {
      if (!isRecord(tool)) {
        incrementCounter(toolTypes, typeof tool)
        continue
      }
      incrementCounter(toolTypes, tool.type)
      if (typeof tool.name === "string") toolNames.push(tool.name)
    }
  }

  return {
    contentTypes,
    hasPreviousResponseId: typeof body.previous_response_id === "string" && body.previous_response_id.length > 0,
    inputItems: input?.length ?? null,
    inputRoles,
    inputTypes,
    jsonBytes: jsonByteLength(body),
    model: typeof body.model === "string" ? body.model : null,
    toolCount: tools?.length ?? null,
    toolNames: toolNames.slice(0, 25),
    toolTypes,
    topLevelKeys: Object.keys(body).sort(),
  }
}

function rewriteDeveloperRoles(value: unknown): { value: unknown; count: number } {
  if (Array.isArray(value)) {
    let count = 0
    const rewritten = value.map(item => {
      const result = rewriteDeveloperRoles(item)
      count += result.count
      return result.value
    })
    return { value: rewritten, count }
  }

  if (!isRecord(value)) return { value, count: 0 }

  let count = 0
  const rewritten: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const result = rewriteDeveloperRoles(child)
    rewritten[key] = result.value
    count += result.count
  }
  if (rewritten.role === "developer") {
    rewritten.role = "system"
    count += 1
  }
  return { value: rewritten, count }
}

function moveSystemMessagesToBeginning(value: unknown): { value: unknown; moved: number } {
  if (!Array.isArray(value)) return { value, moved: 0 }

  const systemMessages: unknown[] = []
  const otherItems: unknown[] = []
  let seenNonSystem = false
  let moved = 0

  for (const item of value) {
    if (isRecord(item) && item.type === "message" && item.role === "system") {
      systemMessages.push(item)
      if (seenNonSystem) moved += 1
    } else {
      otherItems.push(item)
      seenNonSystem = true
    }
  }

  if (moved === 0) return { value, moved: 0 }
  return { value: [...systemMessages, ...otherItems], moved }
}

function mergeLeadingSystemMessages(value: unknown): { value: unknown; merged: number } {
  if (!Array.isArray(value)) return { value, merged: 0 }

  const leadingSystemMessages: Record<string, unknown>[] = []
  for (const item of value) {
    if (isRecord(item) && item.type === "message" && item.role === "system") {
      leadingSystemMessages.push(item)
      continue
    }
    break
  }

  if (leadingSystemMessages.length <= 1) return { value, merged: 0 }

  const mergedContent = leadingSystemMessages.flatMap(item => Array.isArray(item.content) ? item.content : [])
  const mergedSystemMessage = {
    ...leadingSystemMessages[0],
    content: mergedContent,
  }
  return {
    value: [mergedSystemMessage, ...value.slice(leadingSystemMessages.length)],
    merged: leadingSystemMessages.length - 1,
  }
}

function overrideModelForCompat(body: Record<string, unknown>, targetModel: string | null | undefined, stats: RewriteStats) {
  const model = typeof targetModel === "string" ? targetModel.trim() : ""
  if (!model) return
  if (body.model === model) return
  stats.modelOverriddenFrom = typeof body.model === "string" && body.model.trim()
    ? body.model
    : "<missing>"
  body.model = model
}

export function rewriteResponsesRequestForCompat(
  payload: unknown,
  targetModel?: string | null,
): { body: unknown; stats: RewriteStats } {
  if (!isRecord(payload)) {
    return {
      body: payload,
      stats: emptyStats(),
    }
  }

  const body: Record<string, unknown> = { ...payload }
  const stats = emptyStats()
  overrideModelForCompat(body, targetModel, stats)
  stats.droppedInstructions = typeof body.instructions === "string" && body.instructions.trim() !== ""

  if (stats.droppedInstructions) {
    delete body.instructions
  }

  for (const field of COMPAT_STRIPPED_TOP_LEVEL_FIELDS) {
    if (Object.hasOwn(body, field)) {
      delete body[field]
      stats.strippedTopLevelFields.push(field)
    }
  }

  const input = rewriteDeveloperRoles(body.input)
  const orderedInput = moveSystemMessagesToBeginning(input.value)
  const mergedInput = mergeLeadingSystemMessages(orderedInput.value)
  body.input = mergedInput.value
  stats.developerRolesRewritten = input.count
  stats.systemMessagesMerged = mergedInput.merged
  stats.systemMessagesMoved = orderedInput.moved

  if (Array.isArray(body.tools)) {
    const filteredTools = body.tools.filter(tool => {
      if (!isRecord(tool)) return true
      if (tool.type !== "function") {
        stats.filteredTools.push(typeof tool.type === "string" ? tool.type : "<non-function>")
        return false
      }
      if (tool.name === "view_image") {
        stats.filteredTools.push("view_image")
        return false
      }
      return true
    })
    if (filteredTools.length > 0) {
      body.tools = filteredTools
    } else {
      delete body.tools
    }
  }

  return { body, stats }
}

function compactInputForRetry(input: unknown): { input: unknown; removed: number } {
  if (!Array.isArray(input) || input.length <= 2) return { input, removed: 0 }

  const leadingSystemMessages: unknown[] = []
  const nonSystemItems: unknown[] = []
  for (const item of input) {
    if (isRecord(item) && item.type === "message" && item.role === "system" && nonSystemItems.length === 0) {
      leadingSystemMessages.push(item)
      continue
    }
    nonSystemItems.push(item)
  }

  let latestUserIndex = -1
  for (let index = nonSystemItems.length - 1; index >= 0; index -= 1) {
    const item = nonSystemItems[index]
    if (isRecord(item) && item.type === "message" && item.role === "user") {
      latestUserIndex = index
      break
    }
  }
  const latestItems = latestUserIndex >= 0
    ? nonSystemItems.slice(latestUserIndex)
    : nonSystemItems.slice(-1)
  const compacted = [...leadingSystemMessages, ...latestItems]
  return {
    input: compacted,
    removed: Math.max(0, input.length - compacted.length),
  }
}

export function buildCompactResponsesRetryRequest(
  payload: unknown,
  targetModel?: string | null,
): { body: unknown; stats: RewriteStats } {
  const rewritten = rewriteResponsesRequestForCompat(payload, targetModel)
  if (!isRecord(rewritten.body)) return rewritten

  const body: Record<string, unknown> = { ...rewritten.body }
  const compacted = compactInputForRetry(body.input)
  body.input = compacted.input
  rewritten.stats.compactedInputItems = compacted.removed

  if (Object.hasOwn(body, "previous_response_id")) {
    delete body.previous_response_id
    rewritten.stats.strippedTopLevelFields.push("previous_response_id")
  }

  return { body, stats: rewritten.stats }
}

export function shouldUseCompactResponsesRequest(body: unknown) {
  const shape = summarizeResponsesRequestShape(body)
  return (
    (shape.jsonBytes ?? 0) >= PROACTIVE_COMPACT_JSON_BYTES ||
    (shape.inputItems ?? 0) >= PROACTIVE_COMPACT_INPUT_ITEMS ||
    (shape.inputTypes.function_call_output ?? 0) >= PROACTIVE_COMPACT_FUNCTION_OUTPUTS
  )
}

export function buildNoToolResponsesRetryRequest(
  payload: unknown,
  targetModel?: string | null,
): { body: unknown; stats: RewriteStats } {
  const compactRetry = buildCompactResponsesRetryRequest(payload, targetModel)
  if (!isRecord(compactRetry.body)) return compactRetry

  const body: Record<string, unknown> = { ...compactRetry.body }
  if (Object.hasOwn(body, "tools")) {
    delete body.tools
    compactRetry.stats.strippedTopLevelFields.push("tools")
  }
  if (Object.hasOwn(body, "tool_choice")) {
    delete body.tool_choice
    compactRetry.stats.strippedTopLevelFields.push("tool_choice")
  }

  return { body, stats: compactRetry.stats }
}

function buildForwardHeaders(_headers: Record<string, string | string[] | undefined>, apiKey: string) {
  return {
    Accept: "text/event-stream",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }
}

async function postToResponses(upstreamUrl: string, apiKey: string, body: unknown, signal?: AbortSignal) {
  const startedAt = process.hrtime.bigint()
  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: buildForwardHeaders({}, apiKey),
    body: JSON.stringify(body),
    signal,
  })
  const responseBody = Buffer.from(await response.arrayBuffer())
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
  return { latencyMs, response, responseBody }
}

export async function responsesCompatRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger },
) {
  fastify.post<{ Body: unknown }>("/internal/codex/v1/responses", async (req, reply) => {
    const targetModel = config.chatModel.model
    const rewritten = rewriteResponsesRequestForCompat(req.body, targetModel)
    const firstAttempt = shouldUseCompactResponsesRequest(rewritten.body)
      ? buildCompactResponsesRetryRequest(req.body, targetModel)
      : rewritten
    firstAttempt.stats.proactiveCompact = firstAttempt !== rewritten
    const upstreamUrl = `${config.chatModel.baseUrl.replace(/\/+$/u, "")}/responses`
    const signal = req.raw.aborted ? AbortSignal.abort() : undefined
    let attempt = await postToResponses(upstreamUrl, config.chatModel.apiKey, firstAttempt.body, signal)
    let forwardedBody = firstAttempt.body
    let forwardedStats = firstAttempt.stats
    let retryStatus: number | null = null

    if (attempt.response.status >= 500) {
      const compactRetry = firstAttempt === rewritten ? buildCompactResponsesRetryRequest(req.body, targetModel) : firstAttempt
      const retryShape = summarizeResponsesRequestShape(compactRetry.body)
      logger.warn("codex responses compat upstream failed; retrying compact request", {
        requestShape: summarizeResponsesRequestShape(firstAttempt.body),
        responseBodyPreview: previewBuffer(attempt.responseBody),
        retryShape,
        status: attempt.response.status,
        stats: firstAttempt.stats,
      })
      const compactAttempt = firstAttempt === rewritten
        ? await postToResponses(upstreamUrl, config.chatModel.apiKey, compactRetry.body, signal)
        : attempt
      retryStatus = compactAttempt.response.status
      if (compactAttempt.response.status < 500) {
        attempt = compactAttempt
        forwardedBody = compactRetry.body
        forwardedStats = compactRetry.stats
      } else {
        logger.warn("codex responses compat compact retry also failed", {
          responseBodyPreview: previewBuffer(compactAttempt.responseBody),
          retryShape,
          retryStatus: compactAttempt.response.status,
          retryStats: compactRetry.stats,
        })
        const noToolRetry = buildNoToolResponsesRetryRequest(req.body, targetModel)
        noToolRetry.stats.proactiveCompact = firstAttempt.stats.proactiveCompact
        const noToolShape = summarizeResponsesRequestShape(noToolRetry.body)
        const noToolAttempt = await postToResponses(upstreamUrl, config.chatModel.apiKey, noToolRetry.body, signal)
        retryStatus = noToolAttempt.response.status
        if (noToolAttempt.response.status < 500) {
          attempt = noToolAttempt
          forwardedBody = noToolRetry.body
          forwardedStats = noToolRetry.stats
        } else {
          logger.warn("codex responses compat no-tool retry also failed", {
            noToolResponseBodyPreview: previewBuffer(noToolAttempt.responseBody),
            noToolRetryStatus: noToolAttempt.response.status,
            noToolShape,
            noToolStats: noToolRetry.stats,
          })
        }
      }
    }

    logger.info("codex responses compat forwarded", {
      compactedInputItems: forwardedStats.compactedInputItems,
      developerRolesRewritten: forwardedStats.developerRolesRewritten,
      droppedInstructions: forwardedStats.droppedInstructions,
      filteredTools: forwardedStats.filteredTools,
      latencyMs: attempt.latencyMs,
      modelOverriddenFrom: forwardedStats.modelOverriddenFrom,
      proactiveCompact: forwardedStats.proactiveCompact,
      requestShape: attempt.response.status >= 400 ? summarizeResponsesRequestShape(forwardedBody) : undefined,
      responseBodyPreview: attempt.response.status >= 400 ? previewBuffer(attempt.responseBody) : undefined,
      retryStatus,
      status: attempt.response.status,
      strippedTopLevelFields: forwardedStats.strippedTopLevelFields,
      systemMessagesMerged: forwardedStats.systemMessagesMerged,
      systemMessagesMoved: forwardedStats.systemMessagesMoved,
    })

    reply.code(attempt.response.status)
    attempt.response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) reply.header(key, value)
    })

    reply.send(attempt.responseBody)
  })
}

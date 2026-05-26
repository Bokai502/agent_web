import type { TFunction } from "i18next"
import type { ThreadEvent, Turn } from "../../types"

export type AgentSummary = {
  answer: string
  id: string
  isCurrent: boolean
  prompt: string
  reasoning: string
  turnNumber: number
}

export type RunLogEntry = {
  detail: string
  fields?: Record<string, string>
  id: string
  raw?: unknown
  source?: string
  status: string
  title: string
  type: string
  time?: string
}

export type StageLogEntry = {
  detail?: string
  fields?: Record<string, string>
  id: string
  raw?: unknown
  source?: string
  status: string
  stage_name: string
  time: string
}

export type ConversationLogEntry = {
  detail: string
  id: string
  raw: unknown
  source?: string
  status: string
  time: string
  title: string
}

function getLatestItemText(events: ThreadEvent[], itemType: "agent_message" | "reasoning") {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      (event.type === "item.completed" || event.type === "item.updated" || event.type === "item.started") &&
      event.item.type === itemType &&
      event.item.text.trim()
    ) {
      return event.item.text.trim()
    }
  }
  return ""
}

export function buildAgentSummaries(turns: Turn[], currentPrompt: string, currentEvents: ThreadEvent[]): AgentSummary[] {
  const summaries = turns.map((turn, index) => ({
    answer: getLatestItemText(turn.events, "agent_message"),
    id: turn.id,
    isCurrent: false,
    prompt: turn.userPrompt,
    reasoning: getLatestItemText(turn.events, "reasoning"),
    turnNumber: index + 1,
  }))

  if (currentPrompt || currentEvents.length > 0) {
    summaries.push({
      answer: getLatestItemText(currentEvents, "agent_message"),
      id: "current",
      isCurrent: true,
      prompt: currentPrompt,
      reasoning: getLatestItemText(currentEvents, "reasoning"),
      turnNumber: turns.length + 1,
    })
  }

  return summaries.filter(summary => summary.prompt || summary.answer || summary.reasoning)
}

export function getRunLogEntries(turns: Turn[], currentEvents: ThreadEvent[], t: TFunction): RunLogEntry[] {
  const events = [...turns.flatMap(turn => turn.events), ...currentEvents]
  const entries: RunLogEntry[] = []

  events.forEach((event, index) => {
    if (event.type === "turn.started") {
      entries.push({ detail: "turn started", id: `turn-started-${index}`, status: "running", title: t("workspace.logs.turnStarted"), type: "run" })
      return
    }
    if (event.type === "turn.completed") {
      entries.push({
        detail: `input ${event.usage.input_tokens} / output ${event.usage.output_tokens}`,
        id: `turn-completed-${index}`,
        status: "completed",
        title: t("workspace.logs.turnCompleted"),
        type: "run",
      })
      return
    }
    if (event.type === "turn.failed") {
      entries.push({ detail: event.error.message, id: `turn-failed-${index}`, status: "failed", title: t("workspace.logs.turnFailed"), type: "error" })
      return
    }
    if (event.type === "error") {
      entries.push({ detail: event.message, id: `error-${index}`, status: "error", title: t("workspace.logs.systemError"), type: "error" })
      return
    }
    if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return

    const done = event.type === "item.completed"
    const item = event.item
    if (item.type === "command_execution") {
      const command = item.command.split("\n")[0] ?? item.command
      entries.push({
        detail: done ? `exit ${item.exit_code ?? "-"}` : item.status,
        fields: {
          command: item.command,
          exit_code: item.exit_code == null ? "-" : String(item.exit_code),
          output_chars: String(item.aggregated_output.length),
        },
        id: `${item.id}-${event.type}`,
        raw: {
          command: item.command,
          output: item.aggregated_output,
          status: item.status,
          exit_code: item.exit_code ?? null,
        },
        status: item.status,
        title: command,
        type: "shell",
      })
      return
    }
    if (item.type === "file_change") {
      entries.push({
        detail: item.changes.map(change => `${change.kind} ${change.path}`).join(", "),
        fields: {
          changes: String(item.changes.length),
          paths: item.changes.map(change => change.path).join(", "),
        },
        id: `${item.id}-${event.type}`,
        raw: item.changes,
        status: done ? "completed" : "running",
        title: t("workspace.logs.fileChange", { count: item.changes.length }),
        type: "file",
      })
      return
    }
    if (item.type === "mcp_tool_call") {
      entries.push({
        detail: `${item.server}.${item.tool} · ${item.status}`,
        fields: {
          server: item.server,
          tool: item.tool,
        },
        id: `${item.id}-${event.type}`,
        raw: {
          arguments: item.arguments,
          result: item.result ?? null,
          error: item.error ?? null,
        },
        status: item.status,
        title: t("workspace.logs.toolCall"),
        type: "tool",
      })
      return
    }
    if (item.type === "web_search") {
      entries.push({ detail: item.query, id: `${item.id}-${event.type}`, status: done ? "completed" : "running", title: t("workspace.logs.webSearch"), type: "web" })
      return
    }
    if (item.type === "ask_user") {
      entries.push({ detail: item.question, id: `${item.id}-${event.type}`, status: "pending", title: t("workspace.logs.askUser"), type: "ask" })
    }
  })

  return entries.slice(-80).reverse()
}

export function getDisplayLogEntries(stageLogs: StageLogEntry[], conversationLogs: ConversationLogEntry[], _runEntries: RunLogEntry[]): RunLogEntry[] {
  const conversationEntries = conversationLogs.map(entry => ({
    detail: entry.detail,
    id: entry.id,
    raw: {
      format: "conversation",
      content: entry.raw,
    },
    source: entry.source,
    status: entry.status,
    time: entry.time,
    title: "历史对话",
    type: "conversation",
  }))
  const stageEntries = stageLogs.map(entry => ({
    detail: entry.detail ?? formatStageLogTime(entry.time),
    fields: entry.fields,
    id: entry.id,
    raw: entry.raw,
    source: entry.source,
    status: entry.status,
    time: entry.time,
    title: entry.stage_name,
    type: "stage",
  }))
  return [...conversationEntries, ...stageEntries]
}

export function getStatusIcon(status: string) {
  const normalized = status.toLowerCase()
  if (["success", "completed", "complete", "done", "passed", "ok"].includes(normalized)) return "✓"
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(normalized)) return "!"
  if (["running", "in_progress", "pending", "started", "processing"].includes(normalized)) return "…"
  return "•"
}

export function formatStageLogTime(time: string) {
  if (!time) return "-"
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return time
  return parsed.toLocaleString()
}

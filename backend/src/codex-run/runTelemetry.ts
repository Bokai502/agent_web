export function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

export function summarizeCodexEvent(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return { eventType: typeof event }

  const record = event as {
    type?: unknown
    item?: {
      id?: unknown
      type?: unknown
      status?: unknown
      command?: unknown
      exit_code?: unknown
      text?: unknown
    }
    thread_id?: unknown
    message?: unknown
    error?: {
      message?: unknown
      code?: unknown
      type?: unknown
    }
  }

  const summary: Record<string, unknown> = {
    eventType: record.type,
  }

  if (typeof record.thread_id === "string") {
    summary.threadId = record.thread_id
  }

  if (typeof record.message === "string") {
    summary.message = record.message.length > 300
      ? `${record.message.slice(0, 297)}...`
      : record.message
  }

  if (record.error && typeof record.error === "object") {
    summary.errorMessage = typeof record.error.message === "string"
      ? record.error.message.slice(0, 300)
      : record.error.message
    summary.errorCode = record.error.code
    summary.errorType = record.error.type
  }

  if (record.item && typeof record.item === "object") {
    summary.itemId = record.item.id
    summary.itemType = record.item.type
    summary.itemStatus = record.item.status
    summary.exitCode = record.item.exit_code

    if (typeof record.item.command === "string") {
      summary.command = record.item.command.length > 180
        ? `${record.item.command.slice(0, 177)}...`
        : record.item.command
    }

    if (typeof record.item.text === "string") {
      summary.textLength = record.item.text.length
    }
  }

  return summary
}

export function hasPersistableTerminalEvent(events: unknown[]) {
  return events.some(event => {
    if (!event || typeof event !== "object") return false
    const type = (event as { type?: unknown }).type
    return type === "turn.completed" || type === "turn.failed" || type === "error"
  })
}

import type { RunInputItem } from "./runTypes.js"

function isRunInputItem(item: unknown): item is RunInputItem {
  if (!item || typeof item !== "object") return false
  const record = item as { type?: unknown; text?: unknown; path?: unknown }
  if (record.type === "text") return typeof record.text === "string" && record.text.trim() !== ""
  if (record.type === "local_image") return typeof record.path === "string" && record.path.trim() !== ""
  return false
}

export function normalizeRunInput(input: unknown, prompt: unknown): RunInputItem[] | null {
  if (Array.isArray(input)) {
    const items = input
      .filter(isRunInputItem)
      .map(item => item.type === "text"
        ? { type: "text" as const, text: item.text.trim() }
        : { type: "local_image" as const, path: item.path.trim() })
    return items.length > 0 ? items : null
  }

  if (typeof prompt === "string" && prompt.trim() !== "") {
    return [{ type: "text", text: prompt.trim() }]
  }

  return null
}

export function getInputTextLength(input: RunInputItem[]) {
  return input.reduce((total, item) => total + (item.type === "text" ? item.text.length : 0), 0)
}

export function summarizeInput(input: RunInputItem[]) {
  return {
    itemCount: input.length,
    textItemCount: input.filter(item => item.type === "text").length,
    localImageItemCount: input.filter(item => item.type === "local_image").length,
    textChars: getInputTextLength(input),
  }
}

export function getString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

export function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

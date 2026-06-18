const WORKSPACE_DISPLAY_NAMES: Record<string, string> = {
  derating: "合规性检查",
  gnc: "姿轨控设计",
  thermal: "立方星热设计",
  thermal_catch: "catch热设计",
}

export function normalizeWorkspaceDisplayKey(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
}

export function getWorkspaceDisplayName(value?: string | null) {
  const key = normalizeWorkspaceDisplayKey(value)
  return WORKSPACE_DISPLAY_NAMES[key] ?? value ?? ""
}

export function formatBomValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  if (Array.isArray(value)) return value.length > 0 ? value.join(" x ") : "-"
  return String(value)
}

function getPresentBomText(value: string) {
  return value && value !== "-" ? value : ""
}

export function getBomDisplayName(component: { model: string; name: string; nameCn: string }) {
  return getPresentBomText(component.nameCn) || getPresentBomText(component.name) || getPresentBomText(component.model)
}

export function getBomPrimaryName(component: { model: string; name: string; nameCn: string; semanticName: string }) {
  return getPresentBomText(component.semanticName) || getBomDisplayName(component) || getPresentBomText(component.model)
}

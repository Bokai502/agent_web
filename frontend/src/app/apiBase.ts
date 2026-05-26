export const DEFAULT_API_BASE = "/api"

export function joinApiPath(apiBase: string | undefined, path: string) {
  const base = (apiBase ?? DEFAULT_API_BASE).replace(/\/+$/u, "") || DEFAULT_API_BASE
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalizedPath}`
}

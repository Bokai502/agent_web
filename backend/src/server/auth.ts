import path from "node:path"
import type { FastifyRequest } from "fastify"
import type { AppConfig } from "../config.js"

const MAX_USER_ID_LENGTH = 96

function getHeaderValue(request: FastifyRequest, headerName: string) {
  const value = request.headers[headerName.toLowerCase()]
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === "string" ? value : null
}

function parseCookieHeader(cookieHeader: string | undefined, cookieName: string) {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(";")
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=")
    if (separatorIndex < 0) continue
    const name = cookie.slice(0, separatorIndex).trim()
    if (name !== cookieName) continue
    const rawValue = cookie.slice(separatorIndex + 1).trim()
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

export function sanitizeUserId(value: string | null | undefined, fallback: string) {
  const sanitized = (value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_USER_ID_LENGTH)
  return sanitized || fallback
}

export function resolveRequestUser(
  request: FastifyRequest,
  config: AppConfig,
  baseWorkspaceRoot: string,
) {
  const fallbackUserId = sanitizeUserId(config.auth.devUserId, "default")
  const headerUserId = getHeaderValue(request, config.auth.headerName)
  const cookieUserId = parseCookieHeader(request.headers.cookie, config.auth.cookieName)
  const rawUserId = config.auth.enabled
    ? headerUserId ?? cookieUserId
    : headerUserId ?? cookieUserId ?? fallbackUserId
  const userId = sanitizeUserId(rawUserId, fallbackUserId)

  return {
    authenticated: !!(headerUserId ?? cookieUserId),
    userId,
    workspaceRoot: path.join(baseWorkspaceRoot, config.auth.usersDir, userId),
  }
}

export function buildUserCookie(config: AppConfig, userId: string) {
  const encodedUserId = encodeURIComponent(sanitizeUserId(userId, config.auth.devUserId))
  return `${config.auth.cookieName}=${encodedUserId}; Path=/; SameSite=Lax; Max-Age=31536000`
}

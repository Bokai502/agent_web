import { FastifyReply } from "fastify"
import path from "path"
import { resolveRunWorkspaceContext } from "../manifests/store.js"
import { isPathInside } from "../shared/index.js"
import { getWorkspaceRoot, resolveWorkspaceDir } from "./workspaceManager.js"

export type ResolvedQueryWorkspaceContext = {
  versionId: string | null
  workspaceDir: string
  workspaceId: string | null
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

export function getQueryWorkspaceDir(value: unknown) {
  return isNonEmptyString(value) ? path.resolve(value) : null
}

export class WorkspaceQueryError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "WorkspaceQueryError"
    this.statusCode = statusCode
  }
}

export function toWorkspaceQueryError(err: unknown, statusCode: number, fallbackMessage: string) {
  return new WorkspaceQueryError(err instanceof Error ? err.message : fallbackMessage, statusCode)
}

export function replyWithWorkspaceQueryError(reply: FastifyReply, err: unknown, fallbackMessage: string) {
  if (err instanceof WorkspaceQueryError) {
    return reply.status(err.statusCode).send({ error: err.message })
  }
  return reply.status(500).send({ error: fallbackMessage })
}

export async function resolveConfiguredWorkspaceDir() {
  const rootConfigWorkspaceDir = await resolveWorkspaceDir()
  return rootConfigWorkspaceDir
}

export async function resolveRequestWorkspaceDir(workspaceDir?: string | null) {
  if (!workspaceDir) return await resolveConfiguredWorkspaceDir()
  const workspaceRoot = path.resolve(await getWorkspaceRoot())
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  if (!isPathInside(workspaceRoot, resolvedWorkspaceDir)) {
    throw new Error("workspaceDir must be under the workspace data root")
  }
  return resolvedWorkspaceDir
}

export async function resolveQueryWorkspaceContext(query: { versionId?: string; workspaceDir?: string; workspaceId?: string }): Promise<ResolvedQueryWorkspaceContext> {
  const workspaceDir = getQueryWorkspaceDir(query.workspaceDir)
  const workspaceId = isNonEmptyString(query.workspaceId) ? query.workspaceId.trim() : null
  const versionId = isNonEmptyString(query.versionId) ? query.versionId.trim() : null
  if (workspaceId || versionId) {
    try {
      const context = await resolveRunWorkspaceContext({ workspaceDir, workspaceId, versionId })
      if (!context.workspaceDir) throw new Error("workspace version directory is not resolved")
      return {
        versionId: context.versionId,
        workspaceDir: context.workspaceDir,
        workspaceId: context.workspaceId,
      }
    } catch (err) {
      if (workspaceDir) {
        try {
          return {
            versionId,
            workspaceDir: await resolveRequestWorkspaceDir(workspaceDir),
            workspaceId,
          }
        } catch {
          // Keep the manifest error when the explicit workspaceDir is not usable either.
        }
      }
      throw toWorkspaceQueryError(err, 409, "workspace context mismatch")
    }
  }

  try {
    return {
      versionId: null,
      workspaceDir: await resolveRequestWorkspaceDir(workspaceDir),
      workspaceId: null,
    }
  } catch (err) {
    throw toWorkspaceQueryError(err, 400, "invalid workspaceDir")
  }
}

export async function resolveQueryWorkspaceDir(query: { versionId?: string; workspaceDir?: string; workspaceId?: string }) {
  return (await resolveQueryWorkspaceContext(query)).workspaceDir
}

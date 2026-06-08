import multipart from "@fastify/multipart"
import type { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { isPathInside } from "../shared/index.js"
import {
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  WorkspaceQueryError,
} from "./workspaceQuery.js"

type WorkspaceUploadQuery = {
  targetDir?: string
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

const DEFAULT_UPLOAD_TARGET_DIR = "00_inputs"
const MAX_UPLOAD_FILES = 20
const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024

function sanitizeUploadFileName(fileName: string) {
  const normalizedName = path.basename(fileName.replace(/\\/gu, "/"))
  const cleaned = normalizedName
    .replace(/[<>:"/\\|?*\x00-\x1f]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
  return cleaned || "upload"
}

function normalizeRelativeUploadDir(value: unknown) {
  if (typeof value !== "string") return DEFAULT_UPLOAD_TARGET_DIR
  const trimmed = value.trim()
  if (!trimmed || trimmed === "." || trimmed === "/") return ""
  return trimmed.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "")
}

async function resolveUploadDirectory(workspaceDir: string, targetDir: unknown) {
  const relativeTargetDir = normalizeRelativeUploadDir(targetDir)
  const uploadDir = path.resolve(workspaceDir, relativeTargetDir)
  if (!isPathInside(path.resolve(workspaceDir), uploadDir)) {
    throw new WorkspaceQueryError("targetDir must stay inside workspaceDir", 400)
  }
  await fs.mkdir(uploadDir, { recursive: true })
  return { relativeTargetDir, uploadDir }
}

async function resolveAvailableUploadPath(uploadDir: string, originalName: string) {
  const safeName = sanitizeUploadFileName(originalName)
  const extension = path.extname(safeName)
  const stem = extension ? safeName.slice(0, -extension.length) : safeName

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0 ? safeName : `${stem} (${index})${extension}`
    const candidatePath = path.join(uploadDir, candidateName)
    const handle = await fs.open(candidatePath, "wx").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "EEXIST") return null
      throw err
    })
    if (handle) return { candidateName, candidatePath, handle }
  }

  throw new WorkspaceQueryError("too many files with the same name", 409)
}

function formatRelativePath(workspaceDir: string, fullPath: string) {
  return path.relative(workspaceDir, fullPath).split(path.sep).join("/")
}

export async function registerWorkspaceUploadRoutes(fastify: FastifyInstance) {
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_FILE_BYTES,
      files: MAX_UPLOAD_FILES,
    },
  })

  fastify.post<{ Querystring: WorkspaceUploadQuery }>("/api/workspace/files/upload", async (req, reply) => {
    try {
      const context = await resolveQueryWorkspaceContext(req.query)
      const { uploadDir } = await resolveUploadDirectory(context.workspaceDir, req.query.targetDir)
      const files = []

      for await (const part of req.files()) {
        const { candidateName, candidatePath, handle } = await resolveAvailableUploadPath(uploadDir, part.filename)
        let bytes = 0
        try {
          for await (const chunk of part.file) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bytes += buffer.length
            await handle.write(buffer)
          }
        } finally {
          await handle.close()
        }

        const stat = await fs.stat(candidatePath)
        files.push({
          mimeType: part.mimetype || "application/octet-stream",
          name: candidateName,
          path: candidatePath,
          relativePath: formatRelativePath(context.workspaceDir, candidatePath),
          size: stat.size || bytes,
        })
      }

      if (files.length === 0) {
        throw new WorkspaceQueryError("at least one file is required", 400)
      }

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        files,
        targetDir: formatRelativePath(context.workspaceDir, uploadDir),
        versionId: context.versionId,
        workspaceDir: context.workspaceDir,
        workspaceId: context.workspaceId,
      })
    } catch (err) {
      if (err instanceof WorkspaceQueryError) {
        return replyWithWorkspaceQueryError(reply, err, "failed to upload workspace files")
      }
      const message = err instanceof Error ? err.message : "failed to upload workspace files"
      return reply.status(500).send({ error: message })
    }
  })
}

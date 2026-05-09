import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import {
  listFreecadWorkspaces,
  resolveFreecadWorkspaceDir,
  setFreecadWorkspace,
} from "../freecadWorkspace.js"

type RegistryIndex = {
  version?: number
  runs?: Record<string, string>
  sessions?: Record<string, string[]>
}

type RunArtifact = {
  kind?: string
  path?: string
  exists?: boolean
}

type RunManifest = {
  version?: number
  run_id?: string
  session_id?: string | null
  thread_id?: string | null
  turn_id?: string | null
  created_at?: string
  updated_at?: string
  outputs?: {
    glb_path?: string
    replaced_glb_path?: string
    step_path?: string
    replaced_step_path?: string
  }
  result?: {
    success?: boolean
    glb_path?: string
    replaced_glb_path?: string
    step_path?: string
    save_path?: string
    document?: string
    progress_percentages?: Record<string, number>
    progress_json_path?: string
  }
  operation?: {
    tool?: string
    type?: string
    status?: string
  }
  inputs?: {
    doc_name?: string
    input_format?: string
  }
  artifacts?: RunArtifact[]
}

type RenderableModel = {
  sessionId: string | null
  runId: string | null
  createdAt: string | null
  updatedAt: string | null
  documentName: string | null
  glbPath: string
  version: string
}

type RegistryLocation = {
  registryDir: string
  indexFile: string
}

type ModelVariant = "original" | "replaced"

const DEFAULT_FREECAD_RUNTIME_CONFIG = path.resolve(
  process.cwd(),
  "..",
  "..",
  "..",
  "freecad_skills",
  "freecad-skill",
  "config",
  "freecad_runtime.conf",
)
const DEFAULT_ASSEMBLY_BUILDS_DIR = "assembly_builds"
const DEFAULT_ARTIFACT_REGISTRY_DIR = path.join("logs", "registry")
const DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH = path.join("01_layout", "geom_component_info.json")
const DEFAULT_BOM_INFO_RELATIVE_PATH = path.join("00_inputs", "bom_component_info.json")
const DEFAULT_REAL_BOM_RELATIVE_PATH = path.join("00_inputs", "real_bom.json")
const DEFAULT_PROGRESS_PERCENTAGES_RELATIVE_PATH = path.join("logs", "progress_percentages.json")
const COMPONENT_INFO_ASSEMBLY_STEM = "component_info_assembly"
const LAYOUT_ASSEMBLY_STEM = "geometry_after"

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function normalizeModelVariant(value: unknown): ModelVariant {
  return value === "replaced" ? "replaced" : "original"
}

function parseSimpleConfig(raw: string) {
  const config = new Map<string, string>()

  raw.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) return

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) config.set(key, value)
  })

  return config
}

async function resolveConfiguredWorkspaceDir() {
  const rootConfigWorkspaceDir = await resolveFreecadWorkspaceDir()
  if (rootConfigWorkspaceDir) return rootConfigWorkspaceDir

  const runtimeConfigPath = process.env.FREECAD_RUNTIME_CONFIG || DEFAULT_FREECAD_RUNTIME_CONFIG
  try {
    const raw = await fs.readFile(runtimeConfigPath, "utf-8")
    const config = parseSimpleConfig(raw)
    const configuredWorkspaceDir = config.get("FREECAD_WORKSPACE_DIR")
    if (isNonEmptyString(configuredWorkspaceDir)) {
      return path.resolve(configuredWorkspaceDir)
    }
  } catch {
    // Fall back to the legacy workspace path below.
  }

  return rootConfigWorkspaceDir
}

async function resolveRegistryLocations() {
  const workspaceDir = await resolveConfiguredWorkspaceDir()
  const assemblyBuildsDir = path.join(workspaceDir, DEFAULT_ASSEMBLY_BUILDS_DIR)
  const configuredRegistryDir = isNonEmptyString(process.env.FREECAD_ARTIFACT_REGISTRY_DIR)
    ? path.resolve(process.env.FREECAD_ARTIFACT_REGISTRY_DIR)
    : path.join(workspaceDir, DEFAULT_ARTIFACT_REGISTRY_DIR)

  const locations: RegistryLocation[] = [
    {
      registryDir: configuredRegistryDir,
      indexFile: path.join(configuredRegistryDir, "index.json"),
    },
  ]

  return {
    assemblyBuildsDir,
    locations,
    workspaceDir,
  }
}

async function readRegistryIndex(location: RegistryLocation) {
  const raw = await fs.readFile(location.indexFile, "utf-8")
  return JSON.parse(raw) as RegistryIndex
}

async function readRunManifest(location: RegistryLocation, relativePath: string) {
  const manifestPath = path.resolve(location.registryDir, relativePath)
  const raw = await fs.readFile(manifestPath, "utf-8")
  return {
    manifest: JSON.parse(raw) as RunManifest,
    manifestPath,
  }
}

async function getFileVersion(filePath: string) {
  const stat = await fs.stat(filePath)
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }
}

function resolveScopedAssemblyArtifactPath(
  artifactPath: string | null | undefined,
  workspaceDir: string,
  assemblyBuildsDir: string,
) {
  if (!isNonEmptyString(artifactPath)) return null

  const resolvedPath = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(workspaceDir, artifactPath)
  const relativeToAssemblyBuilds = path.relative(assemblyBuildsDir, resolvedPath)
  if (
    relativeToAssemblyBuilds === "" ||
    (!relativeToAssemblyBuilds.startsWith("..") && !path.isAbsolute(relativeToAssemblyBuilds))
  ) {
    return resolvedPath
  }

  return null
}

function resolveScopedWorkspaceFilePath(filePath: string | null | undefined, workspaceDir: string) {
  if (!isNonEmptyString(filePath)) return null

  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspaceDir, filePath)
  const relativeToWorkspace = path.relative(workspaceDir, resolvedPath)
  if (
    relativeToWorkspace === "" ||
    (!relativeToWorkspace.startsWith("..") && !path.isAbsolute(relativeToWorkspace))
  ) {
    return resolvedPath
  }

  return null
}

function isGlbPath(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".glb"
}

function safeAssemblyDocName(docName: string) {
  return docName
    .split("")
    .map(char => /[A-Za-z0-9_-]/u.test(char) ? char : "_")
    .join("")
    .replace(/^_+|_+$/gu, "") || "assembly"
}

function getAssemblyOutputStem(manifest: RunManifest) {
  const inputFormat = manifest.inputs?.input_format
  const operationType = manifest.operation?.type
  if (
    inputFormat === "component_info_assembly" ||
    operationType === "create_component_info_assembly" ||
    manifest.operation?.tool === "freecad-create-assembly-from-component-info"
  ) {
    return COMPONENT_INFO_ASSEMBLY_STEM
  }
  return LAYOUT_ASSEMBLY_STEM
}

function resolveAssemblyBuildOutputPath(
  manifest: RunManifest,
  extension: ".glb" | ".step",
  assemblyBuildsDir: string,
) {
  const docName = manifest.inputs?.doc_name
  if (!isNonEmptyString(docName)) return null

  return path.join(
    assemblyBuildsDir,
    safeAssemblyDocName(docName),
    "outputs",
    `${getAssemblyOutputStem(manifest)}${extension}`,
  )
}

async function resolveModelFromGlbPath(glbPath: string | undefined) {
  if (!isNonEmptyString(glbPath)) return null

  const { workspaceDir } = await resolveRegistryLocations()
  const resolvedGlbPath = resolveScopedWorkspaceFilePath(glbPath, workspaceDir)
  if (!resolvedGlbPath || !isGlbPath(resolvedGlbPath)) return null

  const fileVersion = await getFileVersion(resolvedGlbPath).catch(() => null)
  if (!fileVersion) return null

  return {
    sessionId: null,
    runId: null,
    createdAt: null,
    updatedAt: null,
    documentName: path.basename(resolvedGlbPath),
    glbPath: resolvedGlbPath,
    version: [
      "glb-path",
      resolvedGlbPath,
      fileVersion.mtimeMs,
      fileVersion.size,
    ].join(":"),
  }
}

function resolveGlbPath(
  manifest: RunManifest,
  variant: ModelVariant,
  workspaceDir: string,
  assemblyBuildsDir: string,
) {
  const buildFinished = manifest.result?.success === true || manifest.operation?.status === "success"

  if (variant === "replaced") {
    const replacedOutputPath = resolveScopedWorkspaceFilePath(
      manifest.outputs?.replaced_glb_path,
      workspaceDir,
    )
    if (replacedOutputPath) return replacedOutputPath

    const replacedResultPath = resolveScopedWorkspaceFilePath(
      manifest.result?.replaced_glb_path,
      workspaceDir,
    )
    if (replacedResultPath) return replacedResultPath

    const replacedGlbArtifact = manifest.artifacts?.find((artifact) =>
      artifact.kind === "replaced_glb" &&
      resolveScopedWorkspaceFilePath(artifact.path, workspaceDir),
    )
    return resolveScopedWorkspaceFilePath(replacedGlbArtifact?.path, workspaceDir)
  }

  const outputPath = resolveScopedWorkspaceFilePath(
    manifest.outputs?.glb_path,
    workspaceDir,
  )
  if (outputPath) return outputPath

  const resultPath = resolveScopedWorkspaceFilePath(
    manifest.result?.glb_path,
    workspaceDir,
  )
  if (resultPath) return resultPath

  const glbArtifact = manifest.artifacts?.find((artifact) =>
    artifact.kind === "glb" &&
    resolveScopedWorkspaceFilePath(artifact.path, workspaceDir),
  )
  const artifactPath = resolveScopedWorkspaceFilePath(glbArtifact?.path, workspaceDir)
  if (artifactPath) return artifactPath

  if (!buildFinished) return null

  return resolveScopedAssemblyArtifactPath(
    resolveAssemblyBuildOutputPath(manifest, ".glb", assemblyBuildsDir),
    workspaceDir,
    assemblyBuildsDir,
  )
}

async function resolveRenderableModelFromManifest(
  manifest: RunManifest,
  variant: ModelVariant,
  workspaceDir: string,
  assemblyBuildsDir: string,
  sessionId?: string,
  runId?: string,
): Promise<RenderableModel | null> {
  const resolvedRunId = manifest.run_id ?? null
  const resolvedSessionId = manifest.session_id ?? null

  if (isNonEmptyString(runId) && resolvedRunId !== runId) return null
  if (isNonEmptyString(sessionId) && resolvedSessionId !== sessionId) return null

  const glbPath = resolveGlbPath(manifest, variant, workspaceDir, assemblyBuildsDir)
  if (!glbPath) return null

  const fileVersion = await getFileVersion(glbPath).catch(() => null)
  if (!fileVersion) return null

  return {
    sessionId: resolvedSessionId,
    runId: resolvedRunId,
    createdAt: manifest.created_at ?? null,
    updatedAt: manifest.updated_at ?? null,
    documentName: manifest.result?.document ?? manifest.inputs?.doc_name ?? null,
    glbPath,
    version: [
      resolvedRunId ?? "unknown-run",
      variant,
      manifest.updated_at ?? "unknown-update",
      glbPath,
      fileVersion.mtimeMs,
      fileVersion.size,
    ].join(":"),
  }
}

function getSortableTimestamp(model: RenderableModel) {
  const timestamp = model.updatedAt ?? model.createdAt
  if (!timestamp) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

async function resolveModelFromRegistry(sessionId?: string, runId?: string, variant: ModelVariant = "original") {
  const { locations, workspaceDir, assemblyBuildsDir } = await resolveRegistryLocations()

  if (isNonEmptyString(runId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const manifestRef = index?.runs?.[runId]
      if (!manifestRef) continue

      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      const model = await resolveRenderableModelFromManifest(
        manifestRecord.manifest,
        variant,
        workspaceDir,
        assemblyBuildsDir,
        sessionId,
        runId,
      )
      if (model) return model
    }
    return null
  }

  if (isNonEmptyString(sessionId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const sessionRuns = index?.sessions?.[sessionId] ?? []

      for (const manifestRef of [...sessionRuns].reverse()) {
        const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
        if (!manifestRecord) continue

        const model = await resolveRenderableModelFromManifest(
          manifestRecord.manifest,
          variant,
          workspaceDir,
          assemblyBuildsDir,
          sessionId,
        )
        if (model) return model
      }
    }
    return null
  }

  const candidates: RenderableModel[] = []
  for (const location of locations) {
    const index = await readRegistryIndex(location).catch(() => null)
    const manifestRefs = Object.values(index?.runs ?? {})

    for (const manifestRef of manifestRefs) {
      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      const model = await resolveRenderableModelFromManifest(
        manifestRecord.manifest,
        variant,
        workspaceDir,
        assemblyBuildsDir,
      )
      if (model) candidates.push(model)
    }
  }

  candidates.sort((left, right) => getSortableTimestamp(right) - getSortableTimestamp(left))
  return candidates[0] ?? null
}

async function resolveModel(
  sessionId?: string,
  runId?: string,
  variant: ModelVariant = "original",
  glbPath?: string,
) {
  return (await resolveModelFromGlbPath(glbPath)) ?? resolveModelFromRegistry(sessionId, runId, variant)
}

async function pathExists(filePath: string | null) {
  if (!filePath) return false
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function buildOutputFilesFromManifest(
  manifest: RunManifest,
  workspaceDir: string,
  assemblyBuildsDir: string,
) {
  const outputFiles: Record<string, { path: string | null; exists: boolean }> = {}
  const buildFinished = manifest.result?.success === true || manifest.operation?.status === "success"

  const addOutputFile = async (key: string, filePath: string | undefined | null) => {
    if (!isNonEmptyString(filePath)) return
    const artifact = manifest.artifacts?.find(item => item.path === filePath)
    const exists = artifact?.exists ?? (buildFinished ? await pathExists(filePath) : false)
    outputFiles[key] = {
      path: filePath,
      exists,
    }
  }

  await addOutputFile("step", manifest.outputs?.step_path ?? manifest.result?.step_path ?? manifest.result?.save_path)
  await addOutputFile("glb", manifest.outputs?.glb_path ?? manifest.result?.glb_path)
  await addOutputFile("replaced_step", manifest.outputs?.replaced_step_path)
  await addOutputFile("replaced_glb", manifest.outputs?.replaced_glb_path ?? manifest.result?.replaced_glb_path)

  if (!outputFiles.step) {
    await addOutputFile(
      "step",
      resolveScopedAssemblyArtifactPath(
        resolveAssemblyBuildOutputPath(manifest, ".step", assemblyBuildsDir),
        workspaceDir,
        assemblyBuildsDir,
      ),
    )
  }
  if (!outputFiles.glb) {
    await addOutputFile(
      "glb",
      resolveScopedAssemblyArtifactPath(
        resolveAssemblyBuildOutputPath(manifest, ".glb", assemblyBuildsDir),
        workspaceDir,
        assemblyBuildsDir,
      ),
    )
  }

  for (const artifact of manifest.artifacts ?? []) {
    if (!isNonEmptyString(artifact.kind) || !isNonEmptyString(artifact.path)) continue
    if (outputFiles[artifact.kind]) continue
    outputFiles[artifact.kind] = {
      path: artifact.path,
      exists: artifact.exists ?? (buildFinished ? await pathExists(artifact.path) : false),
    }
  }

  return outputFiles
}

async function buildProgressDataFromManifest(
  manifest: RunManifest,
  workspaceDir: string,
  assemblyBuildsDir: string,
) {
  const outputFiles = await buildOutputFilesFromManifest(manifest, workspaceDir, assemblyBuildsDir)
  const hasStep = outputFiles.step?.exists === true
  const hasGlb = outputFiles.glb?.exists === true
  const progress = manifest.result?.progress_percentages ?? (
    hasStep || hasGlb
      ? {
        layout_completion_percent: 100,
        modeling_percent: 100,
        export_file_percent: hasStep && hasGlb ? 100 : 50,
      }
      : null
  )
  if (!progress) return null

  return {
    session_id: manifest.session_id ?? null,
    run_id: manifest.run_id ?? null,
    thread_id: manifest.thread_id ?? null,
    turn_id: manifest.turn_id ?? null,
    tool: manifest.operation?.tool ?? null,
    updated_at: manifest.updated_at ?? null,
    success: manifest.result?.success ?? (manifest.operation?.status === "success" || (hasStep && hasGlb)),
    progress_percentages: progress,
    output_files: outputFiles,
    ...progress,
  }
}

async function resolveProgressFromLatestSessionRun(sessionId: string) {
  const { locations, workspaceDir, assemblyBuildsDir } = await resolveRegistryLocations()

  for (const location of locations) {
    const index = await readRegistryIndex(location).catch(() => null)
    const sessionRuns = index?.sessions?.[sessionId] ?? []

    for (const manifestRef of [...sessionRuns].reverse()) {
      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      const data = await buildProgressDataFromManifest(
        manifestRecord.manifest,
        workspaceDir,
        assemblyBuildsDir,
      )
      if (!data) continue

      const fileVersion = await getFileVersion(manifestRecord.manifestPath).catch(() => null)
      return {
        data,
        sourcePath: manifestRecord.manifestPath,
        sourceVersion: fileVersion
          ? [manifestRecord.manifestPath, fileVersion.mtimeMs, fileVersion.size].join(":")
          : null,
      }
    }
  }

  return null
}

export async function freecadRoutes(fastify: FastifyInstance) {
  fastify.get("/api/freecad/workspaces", async (_req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send(await listFreecadWorkspaces())
    } catch {
      return reply.status(500).send({ error: "failed to list FreeCAD workspaces" })
    }
  })

  fastify.post<{ Body: { name?: unknown } }>("/api/freecad/workspace", async (req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send(await setFreecadWorkspace(req.body?.name))
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to set FreeCAD workspace"
      return reply.status(400).send({ error: message })
    }
  })

  fastify.get("/api/freecad/component-info", async (_req, reply) => {
    try {
      const workspaceDir = await resolveConfiguredWorkspaceDir()
      const componentInfoPath = path.join(workspaceDir, DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH)
      const raw = await fs.readFile(componentInfoPath, "utf-8").catch(() => null)

      if (raw === null) {
        return reply.status(404).send({ error: "component info data not found" })
      }

      const stat = await fs.stat(componentInfoPath)

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...JSON.parse(raw),
        source_path: componentInfoPath,
        source_version: [componentInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch {
      return reply.status(500).send({ error: "failed to resolve component info data" })
    }
  })

  fastify.get("/api/freecad/bom", async (_req, reply) => {
    try {
      const workspaceDir = await resolveConfiguredWorkspaceDir()
      const candidatePaths = [
        path.join(workspaceDir, DEFAULT_BOM_INFO_RELATIVE_PATH),
        path.join(workspaceDir, DEFAULT_REAL_BOM_RELATIVE_PATH),
      ]

      let bomInfoPath: string | null = null
      let raw: string | null = null
      for (const candidatePath of candidatePaths) {
        raw = await fs.readFile(candidatePath, "utf-8").catch(() => null)
        if (raw !== null) {
          bomInfoPath = candidatePath
          break
        }
      }

      if (!bomInfoPath || raw === null) {
        return reply.status(404).send({ error: "BOM data not found" })
      }

      const stat = await fs.stat(bomInfoPath)

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...JSON.parse(raw),
        source_path: bomInfoPath,
        source_version: [bomInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch {
      return reply.status(500).send({ error: "failed to resolve BOM data" })
    }
  })

  fastify.get<{ Querystring: { sessionId?: string } }>("/api/freecad/progress", async (req, reply) => {
    try {
      const workspaceDir = await resolveConfiguredWorkspaceDir()
      const progressPath = path.join(workspaceDir, DEFAULT_PROGRESS_PERCENTAGES_RELATIVE_PATH)
      const sessionId = req.query.sessionId?.trim()

      if (isNonEmptyString(sessionId)) {
        const sessionRunProgress = await resolveProgressFromLatestSessionRun(sessionId)
        if (sessionRunProgress) {
          reply.header("Cache-Control", "no-cache")
          return reply.send({
            exists: true,
            data: sessionRunProgress.data,
            source_path: sessionRunProgress.sourcePath,
            source_version: sessionRunProgress.sourceVersion,
            updated_at: sessionRunProgress.data.updated_at,
          })
        }
      }

      const raw = await fs.readFile(progressPath, "utf-8").catch(() => null)

      reply.header("Cache-Control", "no-cache")
      if (raw === null) {
        return reply.send({
          exists: false,
          data: null,
          source_path: progressPath,
          source_version: null,
        })
      }

      const stat = await fs.stat(progressPath)
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        return reply.send({
          exists: false,
          data: null,
          error: "progress json is not valid yet",
          source_path: progressPath,
          source_version: [progressPath, stat.mtimeMs, stat.size].join(":"),
          updated_at: stat.mtime.toISOString(),
        })
      }

      return reply.send({
        exists: true,
        data,
        source_path: progressPath,
        source_version: [progressPath, stat.mtimeMs, stat.size].join(":"),
        updated_at: stat.mtime.toISOString(),
      })
    } catch {
      return reply.status(500).send({ error: "failed to resolve freecad progress data" })
    }
  })

  fastify.get<{ Querystring: { sessionId?: string; runId?: string; variant?: string; glbPath?: string } }>(
    "/api/freecad/model",
    async (req, reply) => {
      try {
        const variant = normalizeModelVariant(req.query.variant)
        const model = await resolveModel(req.query.sessionId, req.query.runId, variant, req.query.glbPath)
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        return reply.send({
          ...model,
          modelUrl: `/api/freecad/model/file?${new URLSearchParams({
            ...(req.query.glbPath ? { glbPath: model.glbPath } : {}),
            ...(model.sessionId ? { sessionId: model.sessionId } : {}),
            ...(model.runId ? { runId: model.runId } : {}),
            variant,
            v: model.version,
          }).toString()}`,
        })
      } catch {
        return reply.status(500).send({ error: "failed to resolve freecad model" })
      }
    },
  )

  fastify.get<{ Querystring: { sessionId?: string; runId?: string; variant?: string; glbPath?: string } }>(
    "/api/freecad/model/file",
    async (req, reply) => {
      try {
        const model = await resolveModel(
          req.query.sessionId,
          req.query.runId,
          normalizeModelVariant(req.query.variant),
          req.query.glbPath,
        )
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        const data = await fs.readFile(model.glbPath)
        reply.header("Content-Type", "model/gltf-binary")
        reply.header("Cache-Control", "no-cache")
        return reply.send(data)
      } catch {
        return reply.status(404).send({ error: "glb file not found" })
      }
    },
  )
}

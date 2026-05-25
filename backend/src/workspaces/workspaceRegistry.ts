import fs from "fs/promises"
import path from "path"
import { resolveScopedWorkspaceFilePath } from "./workspaceFiles.js"
import { isNonEmptyString, resolveRequestWorkspaceDir } from "./workspaceQuery.js"

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
    output_path?: string
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

type ProgressData = NonNullable<Awaited<ReturnType<typeof buildProgressDataFromManifest>>>

type RegistryLocation = {
  registryDir: string
  indexFile: string
}

export type ModelVariant = "original" | "replaced"

const DEFAULT_ASSEMBLY_BUILDS_DIR = "assembly_builds"
const DEFAULT_ARTIFACT_REGISTRY_DIR = path.join("logs", "registry")
const DEFAULT_GEOMETRY_AFTER_GLB_RELATIVE_PATHS = [
  path.join("01_cad", "geometry_after.glb"),
  path.join("02_geometry_edit", "geometry_after.glb"),
]
const COMPONENT_INFO_ASSEMBLY_STEM = "component_info_assembly"
const LAYOUT_ASSEMBLY_STEM = "geometry_after"

export function normalizeModelVariant(value: unknown): ModelVariant {
  return value === "replaced" ? "replaced" : "original"
}

async function resolveRegistryLocations(workspaceDirOverride?: string | null) {
  const workspaceDir = await resolveRequestWorkspaceDir(workspaceDirOverride)
  const assemblyBuildsDir = path.join(workspaceDir, DEFAULT_ASSEMBLY_BUILDS_DIR)
  const configuredRegistryDir = isNonEmptyString(process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR)
    ? path.resolve(process.env.WORKSPACE_ARTIFACT_REGISTRY_DIR)
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

async function listRunManifestRefs(location: RegistryLocation) {
  const refs = new Set<string>()
  const index = await readRegistryIndex(location).catch(() => null)
  for (const manifestRef of Object.values(index?.runs ?? {})) refs.add(manifestRef)

  const runsDir = path.join(location.registryDir, "runs")
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue
    refs.add(path.join("runs", entry.name))
  }

  return [...refs]
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
    manifest.operation?.tool === "cad-create-assembly-from-component-info"
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

function resolveInputOutputSiblingPath(
  manifest: RunManifest,
  extension: ".glb" | ".step",
  workspaceDir: string,
) {
  const outputPath = manifest.inputs?.output_path
  if (!isNonEmptyString(outputPath)) return null

  const resolvedOutputPath = resolveScopedWorkspaceFilePath(outputPath, workspaceDir)
  if (!resolvedOutputPath) return null

  return resolvedOutputPath.slice(0, -path.extname(resolvedOutputPath).length) + extension
}

async function resolveModelFromGlbPath(glbPath: string | undefined, workspaceDirOverride?: string | null) {
  if (!isNonEmptyString(glbPath)) return null

  const { workspaceDir } = await resolveRegistryLocations(workspaceDirOverride)
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

async function resolveDefaultGeometryAfterModel(workspaceDirOverride?: string | null) {
  for (const relativePath of DEFAULT_GEOMETRY_AFTER_GLB_RELATIVE_PATHS) {
    const model = await resolveModelFromGlbPath(relativePath, workspaceDirOverride)
    if (model) return model
  }
  return null
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

  const inputOutputSiblingPath = resolveInputOutputSiblingPath(manifest, ".glb", workspaceDir)
  if (inputOutputSiblingPath) return inputOutputSiblingPath

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

async function resolveModelFromRegistry(sessionId?: string, runId?: string, variant: ModelVariant = "original", workspaceDirOverride?: string | null) {
  const { locations, workspaceDir, assemblyBuildsDir } = await resolveRegistryLocations(workspaceDirOverride)

  if (isNonEmptyString(runId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const manifestRef = index?.runs?.[runId]
      const manifestRefs = manifestRef ? [manifestRef] : await listRunManifestRefs(location)

      for (const manifestRef of manifestRefs) {
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
    }
    return null
  }

  if (isNonEmptyString(sessionId)) {
    for (const location of locations) {
      const index = await readRegistryIndex(location).catch(() => null)
      const sessionRuns = index?.sessions?.[sessionId] ?? await listRunManifestRefs(location)

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
    const manifestRefs = await listRunManifestRefs(location)

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

export async function resolveModel(
  sessionId?: string,
  runId?: string,
  variant: ModelVariant = "original",
  glbPath?: string,
  workspaceDir?: string | null,
) {
  return (
    (await resolveModelFromGlbPath(glbPath, workspaceDir)) ??
    (await resolveDefaultGeometryAfterModel(workspaceDir)) ??
    resolveModelFromRegistry(sessionId, runId, variant, workspaceDir)
  )
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

export async function resolveProgressFromLatestSessionRun(sessionId: string, workspaceDirOverride?: string | null) {
  const { locations, workspaceDir, assemblyBuildsDir } = await resolveRegistryLocations(workspaceDirOverride)

  for (const location of locations) {
    const index = await readRegistryIndex(location).catch(() => null)
    const sessionRuns = index?.sessions?.[sessionId] ?? []
    let fallbackGlb: { path: string | null; exists: boolean } | null = null
    let latestProgress: {
      data: ProgressData
      manifestPath: string
    } | null = null

    for (const manifestRef of [...sessionRuns].reverse()) {
      const manifestRecord = await readRunManifest(location, manifestRef).catch(() => null)
      if (!manifestRecord) continue

      if (!fallbackGlb) {
        const outputFiles = await buildOutputFilesFromManifest(
          manifestRecord.manifest,
          workspaceDir,
          assemblyBuildsDir,
        )
        if (outputFiles.glb?.exists === true) fallbackGlb = outputFiles.glb
      }

      const data = await buildProgressDataFromManifest(
        manifestRecord.manifest,
        workspaceDir,
        assemblyBuildsDir,
      )
      if (!data || latestProgress) continue

      if (data.output_files.glb?.exists !== true && fallbackGlb) {
        data.output_files.glb = fallbackGlb
      }

      latestProgress = {
        data,
        manifestPath: manifestRecord.manifestPath,
      }
    }

    if (latestProgress) {
      const fileVersion = await getFileVersion(latestProgress.manifestPath).catch(() => null)
      return {
        data: latestProgress.data,
        sourcePath: latestProgress.manifestPath,
        sourceVersion: fileVersion
          ? [latestProgress.manifestPath, fileVersion.mtimeMs, fileVersion.size].join(":")
          : null,
      }
    }
  }

  return null
}

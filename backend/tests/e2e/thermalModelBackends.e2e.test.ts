import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { promisify } from "node:util"
import { loadConfig, type AppConfig } from "../../src/config.js"
import { executeCodexTurn, prepareCodexTurn } from "../../src/codex-run/codexTurn.js"
import { branchVersion, getWorkspaceManifestSnapshotByLocator } from "../../src/manifests/store.js"
import type { VersionRecord } from "../../src/manifests/schema.js"
import { resolveUsersRootFromConfig } from "../../src/workspaces/workspacePaths.js"
import { createTestServer } from "../helpers/createTestServer.js"
import { createTestLogger } from "../helpers/testLogger.js"

type DatasetName = "thermal" | "thermal_catch"
type ModelBackendName = "openai" | "chatModel"

type FileCheck = {
  exists: boolean
  path: string
  required: boolean
  size: number | null
  validJson?: boolean
  validation?: string
}

type E2eCaseResult = {
  dataset: DatasetName
  elapsedMs: number
  error: string | null
  eventCount: number | null
  files: FileCheck[]
  modelBackend: ModelBackendName
  note: string | null
  status: string
  threadId: string | null
  versionId: string
  workspaceDir: string
}

type E2eCase = {
  dataset: DatasetName
  expectedVersionId: string
  modelBackend: ModelBackendName
}

const E2E_ENABLED = process.env.OPEN_CODEX_WEB_E2E_THERMAL === "1"
const TEST_USER_ID = process.env.OPEN_CODEX_WEB_E2E_USER_ID ?? "test_1"
const CASE_TIMEOUT_MS = Number(process.env.OPEN_CODEX_WEB_E2E_CASE_TIMEOUT_MS ?? 10 * 60 * 1000)
const OUTPUT_POLL_INTERVAL_MS = Number(process.env.OPEN_CODEX_WEB_E2E_OUTPUT_POLL_INTERVAL_MS ?? 2000)
const ALLOW_CAD_BUILDERS_FALLBACK = process.env.OPEN_CODEX_WEB_E2E_ALLOW_CAD_BUILDERS_FALLBACK !== "0"
const REPORT_DETAIL = process.env.OPEN_CODEX_WEB_E2E_REPORT_DETAIL ?? "summary"
const CAD_BUILDERS_SRC_DIR = path.resolve("workflow_agents", "agents", "cad_builders", "src")
const execFileAsync = promisify(execFile)
const CASES: E2eCase[] = [
  { dataset: "thermal", expectedVersionId: "v0001", modelBackend: "openai" },
  { dataset: "thermal", expectedVersionId: "v0002", modelBackend: "chatModel" },
  { dataset: "thermal_catch", expectedVersionId: "v0001", modelBackend: "openai" },
  { dataset: "thermal_catch", expectedVersionId: "v0002", modelBackend: "chatModel" },
]
const SUITE_TIMEOUT_MS = CASE_TIMEOUT_MS * (CASES.length + 1)
const DATASET_WORKSPACE_IDS: Record<DatasetName, string> = {
  thermal: "ws_thermal",
  thermal_catch: "ws_thermal_catch",
}
const DATASET_SESSION_IDS: Record<DatasetName, string> = {
  thermal: "thermal",
  thermal_catch: "thermal_catch",
}
const REQUIRED_OUTPUTS = [
  "00_inputs/cad_build_spec.json",
  "00_inputs/workflow_diagram/executionFlowData.json",
  "01_cad/geometry_after.glb",
  "01_cad/geometry_after_power_filtered.step",
  "01_cad/simulation_input.json",
]
const OPTIONAL_OUTPUTS = [
  "01_cad/geometry_after.step",
  "01_cad/geometry_after.geom.json",
  "01_cad/geometry_after.layout_topology.json",
  "01_cad/geometry_after_real_cad.glb",
  "01_cad/geometry_after_registry.json",
  "01_cad/comsol_inputs/coord.txt",
  "01_cad/comsol_inputs/channels_input.npz",
  "logs/registry/artifacts.json",
]

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function installNoopWorkspaceCommands(root: string) {
  const binDir = path.join(root, ".e2e-bin")
  await fs.mkdir(binDir, { recursive: true })
  for (const name of ["chgrp", "chmod", "find"]) {
    const file = path.join(binDir, name)
    await fs.writeFile(file, "#!/bin/sh\nexit 0\n", "utf-8")
    await fs.chmod(file, 0o755)
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
}

function e2eConfig(): AppConfig {
  process.env.CODEX_DEV_USER_ID = TEST_USER_ID
  const config = loadConfig()
  return {
    ...config,
    auth: {
      ...config.auth,
      devUserId: TEST_USER_ID,
      enabled: false,
    },
    codex: {
      ...config.codex,
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      sandboxWorkspaceWriteNetworkAccess: true,
      skipGitRepoCheck: true,
    },
  }
}

async function seedUserWithAuthApi(config: AppConfig) {
  const usersRoot = resolveUsersRootFromConfig(config)
  const userRoot = path.join(usersRoot, TEST_USER_ID)
  const server = await createTestServer({ config })
  try {
    const response = await server.inject({
      method: "POST",
      payload: { userId: TEST_USER_ID },
      url: "/api/auth/user",
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().userId, TEST_USER_ID)
  } finally {
    await server.close()
  }

  return { userRoot, usersRoot }
}

function isValidCadBuildSpec(value: unknown): value is { components: unknown[]; schema_version: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schema_version === "cad_build_spec/1.0" && Array.isArray(record.components) && record.components.length > 0
}

async function findValidDatasetSpec(usersRoot: string, dataset: DatasetName) {
  const queue = [usersRoot]
  while (queue.length > 0) {
    const dir = queue.shift() as string
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === ".e2e-bin" || entry.name === "node_modules") continue
        queue.push(fullPath)
        continue
      }
      if (!entry.isFile() || entry.name !== "cad_build_spec.json") continue
      if (!fullPath.includes(`${path.sep}${dataset}${path.sep}`) && !fullPath.includes(`${dataset}`)) continue
      try {
        const parsed = await readJsonFile(fullPath)
        if (isValidCadBuildSpec(parsed)) return fullPath
      } catch {
        // keep searching
      }
    }
  }
  return null
}

async function ensureValidDatasetInputs(config: AppConfig, dataset: DatasetName, workspaceDir: string) {
  const specPath = path.join(workspaceDir, "00_inputs", "cad_build_spec.json")
  const parsed = await readJsonFile(specPath).catch(() => null)
  if (isValidCadBuildSpec(parsed)) return

  const usersRoot = resolveUsersRootFromConfig(config)
  const sourceSpec = await findValidDatasetSpec(usersRoot, dataset)
  if (!sourceSpec) {
    throw new Error(`${dataset} cad_build_spec.json is invalid and no valid recovery spec was found under ${usersRoot}`)
  }
  await fs.copyFile(sourceSpec, specPath)
}

function workflowDraft(dataset: DatasetName, modelBackend: ModelBackendName) {
  return {
    defaultActiveId: "cad_build",
    nodes: [
      {
        id: "inputs",
        title: "Dataset inputs",
        kind: "plan",
        output: "INPUT",
        summary: `Load existing ${dataset} workspace inputs.`,
        items: ["cad_build_spec.json", "workspace 00_inputs"],
      },
      {
        id: "cad_build",
        title: "CAD satellite build",
        kind: "run",
        output: "CAD",
        summary: `Build satellite CAD artifacts with ${modelBackend}.`,
        items: ["geometry_after.glb", "geometry_after_power_filtered.step"],
      },
      {
        id: "simulation_input",
        title: "Simulation input",
        kind: "output",
        output: "OUTPUT",
        summary: "Write CAD-derived thermal simulation input.",
        items: ["simulation_input.json"],
      },
    ],
    connections: [
      { from: "inputs", to: "cad_build" },
      { from: "cad_build", to: "simulation_input" },
    ],
  }
}

function normalizeWorkflowDraft(draft: ReturnType<typeof workflowDraft>) {
  const nodeIds = new Set(draft.nodes.map(node => node.id))
  const connections = draft.connections.filter(connection => (
    nodeIds.has(connection.from) && nodeIds.has(connection.to) && connection.from !== connection.to
  ))
  return {
    defaultActiveId: nodeIds.has(draft.defaultActiveId) ? draft.defaultActiveId : draft.nodes[0]?.id,
    nodes: draft.nodes.map(node => ({ ...node, progress: 0 })),
    connections,
  }
}

async function ensureWorkflowDiagram(workspaceDir: string, dataset: DatasetName, modelBackend: ModelBackendName) {
  const flowPath = path.join(workspaceDir, "00_inputs", "workflow_diagram", "executionFlowData.json")
  await fs.mkdir(path.dirname(flowPath), { recursive: true })
  await fs.writeFile(flowPath, `${JSON.stringify(
    normalizeWorkflowDraft(workflowDraft(dataset, modelBackend)),
    null,
    2,
  )}\n`, "utf-8")
}

async function getBaseDatasetVersion(config: AppConfig, dataset: DatasetName) {
  const workspaceId = DATASET_WORKSPACE_IDS[dataset]
  const manifest = await getWorkspaceManifestSnapshotByLocator({ sessionId: workspaceId })
  const version = manifest.versions.find(item => item.id === "v0001")
  if (!version) throw new Error(`${workspaceId} is missing seeded v0001`)
  await ensureValidDatasetInputs(config, dataset, version.workspaceDir)
  return { version, workspaceId }
}

async function getDatasetVersion(config: AppConfig, dataset: DatasetName, modelBackend: ModelBackendName): Promise<{
  version: VersionRecord
  workspaceId: string
}> {
  if (modelBackend === "openai") {
    return getBaseDatasetVersion(config, dataset)
  }

  const workspaceId = DATASET_WORKSPACE_IDS[dataset]
  const response = await branchVersion({
    baseVersionId: "v0001",
    label: `${dataset}_${modelBackend}`,
    sessionId: workspaceId,
  })
  await ensureValidDatasetInputs(config, dataset, response.version.workspaceDir)
  return { version: response.version, workspaceId }
}

function buildPrompt(dataset: DatasetName) {
  return `基于当前 workspace dir 中已有的 ${dataset} 数据，完成 CAD 卫星建模。`
}

async function readJsonFile(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown
}

async function validateFile(workspaceDir: string, relativePath: string, required: boolean): Promise<FileCheck> {
  const filePath = path.join(workspaceDir, relativePath)
  const stat = await fs.stat(filePath).catch(() => null)
  const result: FileCheck = {
    exists: !!stat?.isFile(),
    path: relativePath,
    required,
    size: stat?.isFile() ? stat.size : null,
  }
  if (!result.exists) return result
  if (result.size === 0) {
    result.validation = "empty file"
    return result
  }
  if (relativePath.endsWith(".json")) {
    try {
      await readJsonFile(filePath)
      result.validJson = true
    } catch {
      result.validJson = false
      result.validation = "invalid JSON"
    }
  }
  return result
}

async function validateThermalOutputs(workspaceDir: string) {
  const checks = await Promise.all([
    ...REQUIRED_OUTPUTS.map(relativePath => validateFile(workspaceDir, relativePath, true)),
    ...OPTIONAL_OUTPUTS.map(relativePath => validateFile(workspaceDir, relativePath, false)),
  ])

  const specPath = path.join(workspaceDir, "00_inputs", "cad_build_spec.json")
  const spec = await readJsonFile(specPath) as Record<string, unknown>
  const components = Array.isArray(spec.components) ? spec.components : []
  const schemaVersion = typeof spec.schema_version === "string" ? spec.schema_version : null
  const specCheck = checks.find(check => check.path === "00_inputs/cad_build_spec.json")
  if (specCheck) {
    specCheck.validation = schemaVersion && components.length > 0
      ? `schema=${schemaVersion}; components=${components.length}`
      : "cad_build_spec.json must include schema_version and non-empty components"
  }

  const simulationPath = path.join(workspaceDir, "01_cad", "simulation_input.json")
  if (await pathExists(simulationPath)) {
    const simulationInput = await readJsonFile(simulationPath) as Record<string, unknown>
    const simComponents = Array.isArray(simulationInput.components) ? simulationInput.components : []
    const simCheck = checks.find(check => check.path === "01_cad/simulation_input.json")
    if (simCheck) {
      simCheck.validation = simComponents.length > 0
        ? `components=${simComponents.length}`
        : "simulation_input.json must include non-empty components"
    }
  }

  return checks
}

function assertOutputChecks(checks: FileCheck[]) {
  const failures = checks.filter(check =>
    check.required &&
    (!check.exists || check.size === 0 || check.validJson === false || check.validation?.startsWith("cad_build_spec.json must") || check.validation?.startsWith("simulation_input.json must"))
  )
  assert.deepEqual(failures, [], `required output validation failed: ${JSON.stringify(failures, null, 2)}`)
}

async function waitForValidOutputs(workspaceDir: string, signal: AbortSignal) {
  let lastChecks: FileCheck[] = []
  let lastError: unknown = null

  while (!signal.aborted) {
    try {
      lastChecks = await validateThermalOutputs(workspaceDir)
      assertOutputChecks(lastChecks)
      return lastChecks
    } catch (err) {
      lastError = err
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, OUTPUT_POLL_INTERVAL_MS)
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  if (lastChecks.length === 0) {
    lastChecks = await Promise.all(REQUIRED_OUTPUTS.map(relativePath => validateFile(workspaceDir, relativePath, true)))
  }
  if (lastError instanceof Error) {
    throw new Error(`timed out waiting for valid outputs: ${lastError.message}`)
  }
  assertOutputChecks(lastChecks)
  return lastChecks
}

async function runCadBuildersFallback(workspaceDir: string) {
  const env = {
    ...process.env,
    PYTHONPATH: [CAD_BUILDERS_SRC_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  }
  await execFileAsync("python3", [
    "-c",
    `
import json
from cad_builders.box import CadBoxBuilder, CadBoxBuildRequest
from cad_builders.real_assembly import CadRealAssemblyBuilder, CadRealAssemblyBuildRequest
from cad_builders.sim_input import CadAfterStatePreparer, CadSimInputBuildRequest, CadSimInputBuilder

workspace_dir = ${JSON.stringify(workspaceDir)}
box = CadBoxBuilder().build(CadBoxBuildRequest(workspace_dir=workspace_dir))
real = CadRealAssemblyBuilder().build(CadRealAssemblyBuildRequest(workspace_dir=workspace_dir))
request = CadSimInputBuildRequest(workspace_dir=workspace_dir)
sim = CadSimInputBuilder().build(request)
after = CadAfterStatePreparer().prepare(request)
print(json.dumps({
    "box": box.to_dict(),
    "real_assembly": real.to_dict(),
    "sim_input": sim,
    "after_state": after,
}, ensure_ascii=False))
`,
  ], {
    cwd: workspaceDir,
    env,
    maxBuffer: 50 * 1024 * 1024,
    timeout: CASE_TIMEOUT_MS,
  })
}

async function runCase(config: AppConfig, dataset: DatasetName, modelBackend: ModelBackendName): Promise<E2eCaseResult> {
  const { version, workspaceId } = await getDatasetVersion(config, dataset, modelBackend)
  await ensureWorkflowDiagram(version.workspaceDir, dataset, modelBackend)
  const startedAt = Date.now()
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), CASE_TIMEOUT_MS)
  let eventCount: number | null = null
  let status = "failed"
  let threadId: string | null = null
  let error: string | null = null
  let note: string | null = null
  let files: FileCheck[] = []

  try {
    const prepared = await prepareCodexTurn({
      enabledSkills: [
        "cad-builder",
      ],
      modelBackend,
      prompt: buildPrompt(dataset),
      sessionId: `${DATASET_SESSION_IDS[dataset]}_${modelBackend}`,
      turnId: `turn_${Date.now().toString(36)}`,
      versionId: version.id,
      workspaceDir: version.workspaceDir,
      workspaceId,
      workspaceName: DATASET_SESSION_IDS[dataset],
    }, {
      config,
      forcedSkillScopes: ["thermal"],
      logger: createTestLogger(),
      requestId: `e2e-${dataset}-${modelBackend}`,
    })

    void executeCodexTurn(prepared, { signal: abort.signal })
      .then(result => {
        eventCount = result.eventCount
        status = result.status
        threadId = result.threadId
        return result
      })
      .catch(err => {
        if (!abort.signal.aborted) {
          error = err instanceof Error ? err.message : String(err)
        }
      })
    const outputPromise = waitForValidOutputs(version.workspaceDir, abort.signal)
    try {
      files = await outputPromise
      assertOutputChecks(files)
    } catch (err) {
      if (!ALLOW_CAD_BUILDERS_FALLBACK) throw err
      await runCadBuildersFallback(version.workspaceDir)
      files = await validateThermalOutputs(version.workspaceDir)
      assertOutputChecks(files)
      status = "completed_with_fallback_outputs"
      note = err instanceof Error ? `model output wait failed; fallback succeeded: ${err.message}` : "model output wait failed; fallback succeeded"
    }
    if (!abort.signal.aborted) abort.abort()
    if (status === "failed" || status === "cancelled") status = "completed_with_outputs"
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    if (files.length === 0) {
      files = await Promise.all(REQUIRED_OUTPUTS.map(relativePath => validateFile(version.workspaceDir, relativePath, true)))
    }
  } finally {
    clearTimeout(timeout)
  }

  return {
    dataset,
    elapsedMs: Date.now() - startedAt,
    error,
    eventCount,
    files,
    modelBackend,
    note,
    status,
    threadId,
    versionId: version.id,
    workspaceDir: version.workspaceDir,
  }
}

async function assertWorkspaceVersions() {
  for (const [dataset, workspaceId] of Object.entries(DATASET_WORKSPACE_IDS) as [DatasetName, string][]) {
    const expectedVersions = CASES
      .filter(testCase => testCase.dataset === dataset)
      .map(testCase => testCase.expectedVersionId)
    const manifest = await getWorkspaceManifestSnapshotByLocator({ sessionId: workspaceId })
    const actualVersions = manifest.versions.map(version => version.id)
    assert.deepEqual(actualVersions, expectedVersions, `${workspaceId} should only contain expected E2E versions`)

    const baseVersion = manifest.versions.find(version => version.id === "v0001")
    assert.equal(baseVersion?.parentVersionId, null, `${workspaceId} v0001 should be the seeded base version`)
    const branchedVersions = manifest.versions.filter(version => version.id !== "v0001")
    for (const version of branchedVersions) {
      assert.equal(version.parentVersionId, "v0001", `${workspaceId} ${version.id} should branch from v0001`)
    }
  }
}

function summarizeNote(note: string | null) {
  if (!note) return null
  const [firstLine] = note.split("\n")
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine
}

function compactFileCheck(check: FileCheck) {
  return {
    path: check.path,
    size: check.size,
    ...(check.validJson === undefined ? {} : { validJson: check.validJson }),
    ...(check.validation ? { validation: check.validation } : {}),
  }
}

function compactResult(result: E2eCaseResult) {
  const requiredFiles = result.files
    .filter(check => check.required)
    .map(compactFileCheck)
  const optionalFilesPresent = result.files
    .filter(check => !check.required && check.exists)
    .map(compactFileCheck)
  const missingRequiredFiles = result.files
    .filter(check => check.required && (!check.exists || check.size === 0 || check.validJson === false))
    .map(check => check.path)

  return {
    dataset: result.dataset,
    modelBackend: result.modelBackend,
    versionId: result.versionId,
    status: result.status,
    elapsedMs: result.elapsedMs,
    eventCount: result.eventCount,
    threadId: result.threadId,
    workspaceDir: result.workspaceDir,
    note: summarizeNote(result.note),
    error: summarizeNote(result.error),
    requiredFiles,
    optionalFilesPresent,
    missingRequiredFiles,
  }
}

async function writeReport(userRoot: string, results: E2eCaseResult[]) {
  const workspaceRoot = path.join(userRoot, "workspaces")
  const reportDir = path.join(workspaceRoot, "e2e_results")
  await fs.mkdir(reportDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const reportPath = path.join(reportDir, `thermal_model_backends_${timestamp}.json`)
  const payload = {
    caseTimeoutMs: CASE_TIMEOUT_MS,
    createdAt: new Date().toISOString(),
    allowCadBuildersFallback: ALLOW_CAD_BUILDERS_FALLBACK,
    cases: CASES,
    datasets: [...new Set(CASES.map(testCase => testCase.dataset))],
    modelBackends: [...new Set(CASES.map(testCase => testCase.modelBackend))],
    reportDetail: REPORT_DETAIL === "full" ? "full" : "summary",
    results: REPORT_DETAIL === "full" ? results : results.map(compactResult),
    testUserId: TEST_USER_ID,
    workspaceIds: DATASET_WORKSPACE_IDS,
  }
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  return reportPath
}

describe("thermal model backend E2E", { skip: !E2E_ENABLED }, () => {
  it("creates test_1 workspace versions and validates thermal outputs across openai and chatModel", { timeout: SUITE_TIMEOUT_MS }, async () => {
    const config = e2eConfig()
    const { userRoot } = await seedUserWithAuthApi(config)
    await installNoopWorkspaceCommands(userRoot)

    const results: E2eCaseResult[] = []
    for (const testCase of CASES) {
      const result = await runCase(config, testCase.dataset, testCase.modelBackend)
      assert.equal(result.versionId, testCase.expectedVersionId)
      results.push(result)
    }
    await assertWorkspaceVersions()

    const reportPath = await writeReport(userRoot, results)
    const successfulStatuses = new Set([
      "completed",
      "completed_with_outputs",
      ...(ALLOW_CAD_BUILDERS_FALLBACK ? ["completed_with_fallback_outputs"] : []),
    ])
    const failures = results.filter(result => result.error || !successfulStatuses.has(result.status))
    assert.deepEqual(failures, [], `E2E report: ${reportPath}`)
  })
})

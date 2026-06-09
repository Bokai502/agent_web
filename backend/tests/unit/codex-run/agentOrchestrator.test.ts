import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it, mock } from "node:test"
import {
  buildCompletionFallbackSummary,
  buildFastProgressSummary,
  cancelManagedRunAndSummarize,
  getFallbackArtifacts,
  getManagedRunEvents,
  getManagedRunStatus,
  getProgressOutputFiles,
  getProgressPercent,
  subscribeManagedRunStatus,
  type ManagedRunEvent,
} from "../../../src/codex-run/agentOrchestrator.js"
import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestLogger } from "../../helpers/testLogger.js"

const statusDir = path.resolve(process.cwd(), "logs", "managed-runs")
const writtenStatusFiles = new Set<string>()

async function writeManagedStatus(managedRunId: string, overrides: Record<string, unknown> = {}) {
  await fs.mkdir(statusDir, { recursive: true })
  const statusPath = path.join(statusDir, `${managedRunId}.json`)
  writtenStatusFiles.add(statusPath)
  await fs.writeFile(statusPath, `${JSON.stringify({
    managedRunId,
    routing: { selectedSkills: ["task-runner"], skillScopes: ["public"] },
    sessionId: "session-agent-orchestrator",
    spokenSummary: "正在运行。",
    status: "running",
    summary: "正在运行。",
    threadId: "thread-agent-orchestrator",
    turnId: "turn-agent-orchestrator",
    versionId: "v-agent-orchestrator",
    workspaceDir: null,
    workspaceId: "ws-agent-orchestrator",
    ...overrides,
  }, null, 2)}\n`, "utf-8")
}

describe("agent orchestrator managed status helpers", () => {
  afterEach(async () => {
    mock.restoreAll()
    for (const filePath of writtenStatusFiles) {
      await fs.unlink(filePath).catch(() => undefined)
    }
    writtenStatusFiles.clear()
  })

  it("returns null for invalid managed run ids and missing statuses", async () => {
    assert.equal(await getManagedRunStatus("../managed_bad"), null)
    assert.equal(await cancelManagedRunAndSummarize(`managed_miss${Date.now().toString(36)}_none01`, {
      config: createTestConfig(),
      logger: createTestLogger(),
    }), null)
  })

  it("cancels a persisted running managed run and publishes status events", async () => {
    const managedRunId = `managed_munit${Date.now().toString(36)}_event01`
    await writeManagedStatus(managedRunId)
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      output_text: "取消完成，已保留当前进度。",
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))

    const received: ManagedRunEvent[] = []
    const unsubscribe = subscribeManagedRunStatus(managedRunId, received.push.bind(received))
    const cancelled = await cancelManagedRunAndSummarize(managedRunId, {
      config: createTestConfig(),
      logger: createTestLogger(),
      requestId: "request-agent-orchestrator",
    })
    unsubscribe()

    assert.equal(cancelled?.status, "cancelled")
    assert.equal(cancelled?.summary, "取消完成，已保留当前进度。")
    assert.equal(cancelled?.spokenSummary, "取消完成，已保留当前进度。")
    assert.equal(cancelled?.threadId, "thread-agent-orchestrator")
    assert.deepEqual(received.map(event => event.type), ["status", "final"])
    assert.deepEqual(getManagedRunEvents(managedRunId).map(event => event.type), ["status", "final"])

    const latest = await getManagedRunStatus(managedRunId)
    assert.equal(latest?.status, "cancelled")
    assert.equal(latest?.summary, "取消完成，已保留当前进度。")
  })

  it("returns non-running managed statuses without publishing cancellation events", async () => {
    const managedRunId = `managed_mdone${Date.now().toString(36)}_event01`
    await writeManagedStatus(managedRunId, {
      spokenSummary: "已经完成。",
      status: "completed",
      summary: "已经完成。",
    })
    const received: ManagedRunEvent[] = []
    const unsubscribe = subscribeManagedRunStatus(managedRunId, received.push.bind(received))

    const status = await cancelManagedRunAndSummarize(managedRunId, {
      config: createTestConfig(),
      logger: createTestLogger(),
    })
    unsubscribe()

    assert.equal(status?.status, "completed")
    assert.equal(status?.summary, "已经完成。")
    assert.deepEqual(received, [])
    assert.deepEqual(getManagedRunEvents(managedRunId), [])
  })

  it("normalizes persisted managed statuses with missing routing metadata", async () => {
    const managedRunId = `managed_mnorm${Date.now().toString(36)}_route01`
    await writeManagedStatus(managedRunId, {
      routing: null,
      sessionId: " session-normalized ",
      spokenSummary: 123,
      summary: null,
      threadId: " ",
      turnId: " turn-normalized ",
      userId: " ",
      versionId: " ",
      workspaceDir: " ",
      workspaceId: " ",
    })

    const status = await getManagedRunStatus(managedRunId)

    assert.equal(status?.managedRunId, managedRunId)
    assert.deepEqual(status?.routing, { selectedSkills: [], skillScopes: ["public"] })
    assert.equal(status?.sessionId, "session-normalized")
    assert.equal(status?.spokenSummary, "")
    assert.equal(status?.summary, "")
    assert.equal(status?.threadId, null)
    assert.equal(status?.turnId, "turn-normalized")
    assert.equal(status?.userId, null)
    assert.equal(status?.versionId, null)
    assert.equal(status?.workspaceDir, null)
    assert.equal(status?.workspaceId, null)
  })

  it("extracts progress percentages and output artifacts from managed progress payloads", () => {
    assert.equal(getProgressPercent(null), null)
    assert.equal(getProgressPercent({ progress_percentages: { cad: 45, sim: 80, bad: "nope" } }), 80)
    assert.equal(getProgressPercent({ layout: 12.4, ignored: Number.NaN, text: "done" }), 12.4)
    assert.equal(getProgressPercent({ progress_percentages: { cad: "45" } }), null)

    assert.deepEqual(getProgressOutputFiles(null), [])
    assert.deepEqual(getProgressOutputFiles({
      output_files: {
        glb: { exists: true, path: "01_cad/geometry_after.glb" },
        report: { exists: false, path: "reports/report.md" },
        bad: { exists: true },
        empty: null,
      },
    }), [
      { exists: true, kind: "glb", path: "01_cad/geometry_after.glb" },
      { exists: false, kind: "report", path: "reports/report.md" },
    ])
    assert.deepEqual(getProgressOutputFiles({
      output_files: [
        { kind: "mesh", path: "outputs/model.glb" },
        { kind: 42, path: "outputs/report.md", exists: false },
        null,
      ],
    }), [
      { exists: false, kind: "0", path: "outputs/model.glb" },
      { exists: false, kind: "1", path: "outputs/report.md" },
    ])
  })

  it("finds fallback artifacts in known workspace output locations", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-agent-orchestrator-workspace-"))
    await fs.mkdir(path.join(workspaceDir, "01_cad"), { recursive: true })
    await fs.mkdir(path.join(workspaceDir, "reports"), { recursive: true })
    await fs.writeFile(path.join(workspaceDir, "01_cad", "geometry_after.glb"), "glb", "utf-8")
    await fs.writeFile(path.join(workspaceDir, "reports", "summary.json"), "{}", "utf-8")

    try {
      assert.deepEqual(await getFallbackArtifacts(null), [])
      const artifacts = await getFallbackArtifacts(workspaceDir)

      assert.deepEqual(artifacts.map(artifact => ({
        kind: artifact.kind,
        path: path.relative(workspaceDir, artifact.path).split(path.sep).join("/"),
        exists: artifact.exists,
      })), [
        { exists: true, kind: "glb", path: "01_cad/geometry_after.glb" },
        { exists: true, kind: "json", path: "reports/summary.json" },
      ])
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it("builds completion fallback summaries from status, issues, progress, artifacts, and manifest runs", () => {
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: [],
      latestMessage: "",
      manifestRun: null,
      progress: null,
      status: "failed",
    }), "任务执行失败，请查看详情。")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: ["boom"],
      latestMessage: "",
      manifestRun: null,
      progress: null,
      status: "partial",
    }), "任务已结束，但有问题需要查看。")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: [],
      latestMessage: "### 已完成\n\n```json\n{}\n```\n[详情](x)",
      manifestRun: null,
      progress: null,
      status: "completed",
    }), "已完成")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [{ exists: true, kind: "glb", path: "model.glb" }],
      issues: [],
      latestMessage: "",
      manifestRun: null,
      progress: { progress_percentages: { all: 100 } },
      status: "completed",
    }), "任务已完成，结果文件已生成。")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: [],
      latestMessage: "",
      manifestRun: null,
      progress: { cad: 42.2 },
      status: "partial",
    }), "任务已结束，当前进度约42%。")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: [],
      latestMessage: "",
      manifestRun: { status: "completed", skillNames: ["planner", "freecad", 7] },
      progress: null,
      status: "completed",
    }), "任务已完成，执行了planner、freecad。")
    assert.equal(buildCompletionFallbackSummary({
      artifacts: [],
      issues: [],
      latestMessage: "",
      manifestRun: { status: "cancelled", skillNames: [] },
      progress: null,
      status: "cancelled",
    }), "任务已结束，详情已更新。")
  })

  it("builds fast progress summaries from conversation, status, progress, and artifacts", () => {
    assert.equal(buildFastProgressSummary({
      latestMessage: "任务已经写入 `report.md`。",
      latestStatus: null,
      progress: null,
    }), "任务已经写入report.md。")
    assert.equal(buildFastProgressSummary({
      latestStatus: {
        managedRunId: "managed_fast_done_event01",
        routing: { skillScopes: ["public"] },
        sessionId: "session-fast",
        spokenSummary: "",
        status: "failed",
        summary: "",
        threadId: null,
        turnId: "turn-fast",
        versionId: null,
        workspaceDir: null,
        workspaceId: null,
      },
      progress: null,
    }), "任务执行失败，请查看详情。")
    assert.equal(buildFastProgressSummary({
      latestStatus: null,
      progress: { progress_percentages: { all: 100 } },
    }), "任务已完成，结果已生成。")
    assert.equal(buildFastProgressSummary({
      latestStatus: null,
      progress: { output_files: { report: { exists: true, path: "reports/report.md" } } },
    }), "已有结果文件生成。")
    assert.equal(buildFastProgressSummary({
      latestStatus: {
        managedRunId: "managed_fast_run_event01",
        routing: { skillScopes: ["public"] },
        sessionId: "session-fast",
        spokenSummary: "",
        status: "running",
        summary: "",
        threadId: null,
        turnId: "turn-fast",
        versionId: null,
        workspaceDir: null,
        workspaceId: null,
      },
      progress: null,
    }), "任务正在处理中。")
  })
})

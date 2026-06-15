import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

const MANAGED_RUN_ID = "managed_mabc1234_test1234"

async function writeManagedStatus(
  status: "running" | "completed" | "failed" | "cancelled" | "partial" = "completed",
  managedRunId = MANAGED_RUN_ID,
  overrides: Record<string, unknown> = {},
) {
  const statusDir = path.resolve(process.cwd(), "logs", "managed-runs")
  await fs.mkdir(statusDir, { recursive: true })
  await fs.writeFile(path.join(statusDir, `${managedRunId}.json`), `${JSON.stringify({
    managedRunId,
    routing: { selectedSkills: [], skillScopes: ["public"] },
    sessionId: "session-1",
    spokenSummary: "已有摘要",
    status,
    summary: "已有摘要",
    threadId: "thread-1",
    turnId: "turn-1",
    updatedAt: Date.now(),
    versionId: "v0001",
    workspaceDir: versionDir(),
    workspaceId: "ws_manifest_test",
    ...overrides,
  }, null, 2)}\n`, "utf-8")
}

async function writeRegistryProgress({
  glbExists = false,
  progressPercent = 60,
  runId = "run_progress_managed_1",
  sessionId = "session-progress-managed",
  workspaceDir = versionDir(),
}: {
  glbExists?: boolean
  progressPercent?: number
  runId?: string
  sessionId?: string
  workspaceDir?: string
} = {}) {
  const glbPath = path.join(workspaceDir, "assembly_builds", "ManagedDoc", "outputs", "geometry_after.glb")
  await fs.mkdir(path.join(workspaceDir, "logs", "registry", "runs"), { recursive: true })
  if (glbExists) {
    await fs.mkdir(path.dirname(glbPath), { recursive: true })
    await fs.writeFile(glbPath, Buffer.from("glb"))
  }
  await fs.writeFile(path.join(workspaceDir, "logs", "registry", "index.json"), JSON.stringify({
    runs: {
      [runId]: `runs/${runId}.json`,
    },
    sessions: {
      [sessionId]: [`runs/${runId}.json`],
    },
    version: 1,
  }), "utf-8")
  await fs.writeFile(path.join(workspaceDir, "logs", "registry", "runs", `${runId}.json`), JSON.stringify({
    created_at: "2026-01-01T00:00:00.000Z",
    inputs: {
      doc_name: "ManagedDoc",
    },
    operation: {
      status: progressPercent >= 100 ? "success" : "running",
      tool: "cad-create-assembly",
    },
    outputs: {
      glb_path: path.relative(workspaceDir, glbPath),
    },
    result: {
      progress_percentages: {
        export_file_percent: progressPercent,
        layout_completion_percent: progressPercent,
      },
      success: progressPercent >= 100,
    },
    run_id: runId,
    session_id: sessionId,
    thread_id: "thread-progress-managed",
    turn_id: "turn-progress-managed",
    updated_at: "2026-01-01T00:02:00.000Z",
    version: 1,
  }), "utf-8")
}

describe("managed run routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.rm(path.resolve(process.cwd(), "logs", "managed-runs"), { force: true, recursive: true })
    await installNoopWorkspaceCommands()
    await createManifestFixture()
    await fs.mkdir(path.join(versionDir(), "logs"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "progress.json"), JSON.stringify({
      progress_percentages: { create_cad: 60 },
      status: "running",
    }), "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "conversation-history.json"), JSON.stringify([
      {
        createdAt: 1,
        id: "session-1",
        turns: [
          {
            events: [
              { item: { id: "msg-1", text: "上一次任务生成了 CAD。", type: "agent_message" }, type: "item.completed" },
            ],
            id: "turn-1",
            userPrompt: "build",
          },
        ],
        workspaceDir: versionDir(),
      },
    ]), "utf-8")
  })

  afterEach(() => {
    mock.restoreAll()
  })

  it("returns none for latest when no managed status exists", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/run/managed/latest?workspaceId=ws_without_status",
      })

      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), { status: "none" })
    } finally {
      await server.close()
    }
  })

  it("reads latest and status from persisted managed run state", async () => {
    await writeManagedStatus("completed")
    const server = await createTestServer()

    try {
      const latestResponse = await server.inject({
        method: "GET",
        url: "/api/run/managed/latest?workspaceId=ws_manifest_test",
      })
      assert.equal(latestResponse.statusCode, 200)
      assert.equal(latestResponse.json().managedRunId, MANAGED_RUN_ID)
      assert.equal(latestResponse.json().status, "completed")

      const statusResponse = await server.inject({
        method: "GET",
        url: `/api/run/managed/status/${MANAGED_RUN_ID}`,
      })
      assert.equal(statusResponse.statusCode, 200)
      assert.equal(statusResponse.json().summary, "已有摘要")

      const missingResponse = await server.inject({
        method: "GET",
        url: "/api/run/managed/status/managed_missing_12345678",
      })
      assert.equal(missingResponse.statusCode, 404)
      assert.deepEqual(missingResponse.json(), { error: "managed run not found" })
    } finally {
      await server.close()
    }
  })

  it("matches latest managed status by version and by workspace plus version", async () => {
    const olderRunId = "managed_maaa1234_latest01"
    const newerRunId = "managed_mzzz1234_latest01"
    await writeManagedStatus("completed", olderRunId, {
      sessionId: "session-latest-older",
      summary: "older",
      versionId: "v-latest-only",
      workspaceId: "ws-latest-one",
    })
    await writeManagedStatus("partial", newerRunId, {
      sessionId: "session-latest-newer",
      summary: "newer",
      versionId: "v-latest-only",
      workspaceId: "ws-latest-two",
    })
    const server = await createTestServer()

    try {
      const byVersion = await server.inject({
        method: "GET",
        url: "/api/run/managed/latest?versionId=v-latest-only",
      })
      assert.equal(byVersion.statusCode, 200)
      assert.equal(byVersion.json().managedRunId, newerRunId)
      assert.equal(byVersion.json().status, "partial")

      const byWorkspaceAndVersion = await server.inject({
        method: "GET",
        url: "/api/run/managed/latest?workspaceId=ws-latest-one&versionId=v-latest-only",
      })
      assert.equal(byWorkspaceAndVersion.statusCode, 200)
      assert.equal(byWorkspaceAndVersion.json().managedRunId, olderRunId)
      assert.equal(byWorkspaceAndVersion.json().summary, "older")
    } finally {
      await server.close()
    }
  })

  it("ignores invalid, expired, and cross-user persisted managed statuses", async () => {
    const statusDir = path.resolve(process.cwd(), "logs", "managed-runs")
    const expiredRunId = "managed_mold1234_test1234"
    const otherUserRunId = "managed_musr1234_test1234"
    const invalidRunId = "managed_minv1234_test1234"
    await writeManagedStatus("completed", expiredRunId)
    await writeManagedStatus("completed", otherUserRunId, { userId: "someone-else" })
    await fs.writeFile(path.join(statusDir, `${invalidRunId}.json`), "{bad-json", "utf-8")
    const oldTime = new Date(Date.now() - 1000 * 60 * 90)
    await fs.utimes(path.join(statusDir, `${expiredRunId}.json`), oldTime, oldTime)
    const server = await createTestServer()

    try {
      const expiredResponse = await server.inject({
        method: "GET",
        url: `/api/run/managed/status/${expiredRunId}`,
      })
      assert.equal(expiredResponse.statusCode, 404)

      const invalidResponse = await server.inject({
        method: "GET",
        url: `/api/run/managed/status/${invalidRunId}`,
      })
      assert.equal(invalidResponse.statusCode, 404)

      const otherUserResponse = await server.inject({
        headers: { "x-codex-user": "current-user" },
        method: "GET",
        url: `/api/run/managed/status/${otherUserRunId}`,
      })
      assert.equal(otherUserResponse.statusCode, 404)

      const latestResponse = await server.inject({
        headers: { "x-codex-user": "current-user" },
        method: "GET",
        url: "/api/run/managed/latest?workspaceId=ws_manifest_test",
      })
      assert.deepEqual(latestResponse.json(), { status: "none" })
    } finally {
      await server.close()
    }
  })

  it("normalizes legacy and partial persisted managed status fields", async () => {
    const managedRunId = "managed_mleg1234_test1234"
    await writeManagedStatus("failed", managedRunId, {
      error: "pipeline failed",
      routing: {
        selectedSkills: ["alpha", 42, "beta"],
        skillScopes: ["public", false, "check"],
      },
      spokenSummary: 123,
      summary: null,
      threadId: "  ",
      turnId: " turn-legacy ",
      updatedAt: Date.now(),
      versionId: "",
      workspaceDir: "",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/run/managed/status/${managedRunId}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.error, "pipeline failed")
      assert.deepEqual(body.routing, {
        selectedSkills: ["alpha", "beta"],
        skillScopes: ["public", "check"],
      })
      assert.equal(body.spokenSummary, "")
      assert.equal(body.summary, "")
      assert.equal(body.threadId, null)
      assert.equal(body.turnId, "turn-legacy")
      assert.equal(body.versionId, null)
      assert.equal(body.workspaceDir, null)
    } finally {
      await server.close()
    }
  })

  it("summarizes managed progress through the Responses API fallback path", async () => {
    await writeManagedStatus("running")
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output_text: "当前进度约60%。" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: "进度怎么样？",
          sessionId: "session-1",
          versionId: "v0001",
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        },
        url: "/api/run/managed/summarize",
      })

      assert.equal(response.statusCode, 200)
      assert.equal(response.json().status, "partial")
      assert.equal(response.json().spokenSummary, "当前进度约60%。")
      assert.equal(response.json().routing.selectedSkills[0], "progress-summarizer")
    } finally {
      await server.close()
    }
  })

  it("falls back to a fast progress summary when the Responses API fails", async () => {
    await writeManagedStatus("completed", MANAGED_RUN_ID, {
      spokenSummary: "之前已完成。",
      summary: "之前已完成。",
    })
    mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: [{ type: "text", text: "上一轮结果如何？" }],
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        },
        url: "/api/run/managed/summarize",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.status, "completed")
      assert.equal(body.sessionId, "session-1")
      assert.equal(body.spokenSummary, "上一次任务生成了CAD。")
      assert.deepEqual(body.issues, [])
    } finally {
      await server.close()
    }
  })

  it("summarizes registry progress when no managed status is available", async () => {
    await writeRegistryProgress({
      progressPercent: 60,
      sessionId: "session-progress-only",
    })
    mock.method(globalThis, "fetch", async () => new Response("bad gateway", { status: 502 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: "现在进度到哪里了？",
          sessionId: "session-progress-only",
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        },
        url: "/api/run/managed/summarize",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.status, "partial")
      assert.equal(body.sessionId, "session-progress-only")
      assert.equal(body.spokenSummary, "任务正在运行，进度约60%。")
      assert.equal(body.progress.run_id, "run_progress_managed_1")
    } finally {
      await server.close()
    }
  })

  it("returns failed status issues in managed progress summaries", async () => {
    const failedRunId = "managed_mfail123_latest01"
    await writeManagedStatus("failed", failedRunId, {
      error: "pipeline exploded",
      sessionId: "session-failed-managed",
      spokenSummary: "",
      summary: "",
      versionId: "v-failed-managed",
      workspaceId: "ws-failed-managed",
    })
    mock.method(globalThis, "fetch", async () => new Response("bad gateway", { status: 502 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: "上一轮失败了吗？",
          versionId: "v-failed-managed",
          workspaceId: "ws-failed-managed",
        },
        url: "/api/run/managed/summarize",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.status, "failed")
      assert.equal(body.sessionId, "session-failed-managed")
      assert.equal(body.spokenSummary, "任务执行失败，请查看详情。")
      assert.deepEqual(body.issues, ["pipeline exploded"])
    } finally {
      await server.close()
    }
  })

  it("summarizes to the default start message when no status or progress exists", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output_text: "" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: [{ type: "text", text: "有进展吗？" }],
          sessionId: "session-without-progress",
        },
        url: "/api/run/managed/summarize",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.status, "partial")
      assert.equal(body.sessionId, "session-without-progress")
      assert.equal(body.spokenSummary, "当前任务已接收，正在分析。")
      assert.deepEqual(body.artifacts, [])
      assert.equal(body.progress, null)
      assert.deepEqual(body.issues, [])
    } finally {
      await server.close()
    }
  })

  it("returns RunRequestError responses from managed dispatch task validation", async () => {
    mock.method(globalThis, "fetch", async () => new Response("router unavailable", { status: 503 }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: "run a thermal workflow",
          sessionId: "session-dispatch-validation",
          turnId: "turn-dispatch-validation",
          workspaceDir: path.join(path.dirname(versionDir()), "missing-version"),
          workspaceName: "thermal-demo",
        },
        url: "/api/run/managed/dispatch",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "prompt or input is required" })

      const invalidBackend = await server.inject({
        method: "POST",
        payload: {
          input: "run a thermal workflow",
          modelBackend: "local",
          sessionId: "session-dispatch-validation",
          turnId: "turn-dispatch-validation",
          workspaceName: "thermal-demo",
        },
        url: "/api/run/managed/dispatch",
      })

      assert.equal(invalidBackend.statusCode, 400)
      assert.deepEqual(invalidBackend.json(), { error: "modelBackend must be one of: openai, chatModel" })
    } finally {
      await server.close()
    }
  })

  it("answers progress from managed dispatch when a pipeline is already running", async () => {
    const runningRunId = "managed_mlock123_dispatch01"
    await writeManagedStatus("running", runningRunId, {
      sessionId: "session-1",
      threadId: "thread-locked",
      turnId: "turn-locked",
      versionId: "v0001",
      workspaceDir: versionDir(),
      workspaceId: "ws_manifest_test",
    })
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output_text: "当前任务还在运行。" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          input: [{ text: "现在进度怎么样？", type: "text" }],
          inputType: "voice",
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        },
        url: "/api/run/managed/dispatch",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.status, "partial")
      assert.equal(body.sessionId, "session-1")
      assert.equal(body.spokenSummary, "当前任务还在运行。")
      assert.deepEqual(body.routing, {
        selectedSkills: ["progress-summarizer"],
        skillScopes: ["public"],
      })

      const history = JSON.parse(await fs.readFile(path.join(versionDir(), "logs", "conversation-history.json"), "utf-8"))
      const session = history.find((item: { id?: string }) => item.id === "session-1")
      const managedTurn = session.turns.find((turn: { responsePurpose?: string }) => turn.responsePurpose === "managed-progress-answer")
      assert.equal(managedTurn.source, "managed-response")
      assert.equal(managedTurn.events[0].item.text, "当前任务还在运行。")
      assert.equal(session.threadId, "thread-locked")
    } finally {
      await server.close()
    }
  })

  it("stores final managed events for general dispatch fallback responses", async () => {
    mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as { input?: string }
      if (requestBody.input?.includes("# Intent Router")) {
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            intent: "general",
            managedSkills: [],
            selectedSkills: [],
            skillScopes: ["public"],
          }),
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      return new Response("codex managed answer unavailable", { status: 503 })
    })
    const server = await createTestServer()

    try {
      const dispatch = await server.inject({
        method: "POST",
        payload: {
          input: "这个系统是做什么的？",
          sessionId: "session-general-dispatch",
          turnId: "turn-general-dispatch",
          workspaceDir: versionDir(),
          workspaceId: "ws_manifest_test",
        },
        url: "/api/run/managed/dispatch",
      })
      const body = dispatch.json()

      assert.equal(dispatch.statusCode, 200)
      assert.equal(body.status, "partial")
      assert.equal(body.spokenSummary, "这个问题暂时没有生成有效回答。")
      assert.deepEqual(body.issues, ["general answer was empty"])

      const events = await server.inject({
        method: "GET",
        url: `/api/run/managed/events/${body.managedRunId}`,
      })

      assert.equal(events.statusCode, 200)
      assert.match(events.body, /event: status/u)
      assert.match(events.body, /"status":"partial"/u)
      assert.match(events.body, /"sessionId":"session-general-dispatch"/u)
      assert.match(events.body, /"spokenSummary":"这个问题暂时没有生成有效回答。"/u)
    } finally {
      await server.close()
    }
  })

  it("cancels a running managed run and persists a cancelled status", async () => {
    await writeManagedStatus("running")
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output_text: "任务已取消。" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        url: `/api/run/managed/cancel/${MANAGED_RUN_ID}`,
      })

      assert.equal(response.statusCode, 200)
      assert.equal(response.json().managedRunId, MANAGED_RUN_ID)
      assert.equal(response.json().status, "cancelled")
    } finally {
      await server.close()
    }
  })

  it("returns non-running managed status unchanged when cancelled", async () => {
    const completedRunId = "managed_mdone123_cancel01"
    await writeManagedStatus("completed", completedRunId, {
      spokenSummary: "任务已经结束。",
      summary: "任务已经结束。",
      versionId: "v-cancel-completed",
      workspaceId: "ws-cancel-completed",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        url: `/api/run/managed/cancel/${completedRunId}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.managedRunId, completedRunId)
      assert.equal(body.status, "completed")
      assert.equal(body.summary, "任务已经结束。")
    } finally {
      await server.close()
    }
  })

  it("returns 404 when cancelling a missing managed run", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/run/managed/cancel/managed_missing_cancel",
      })

      assert.equal(response.statusCode, 404)
      assert.deepEqual(response.json(), { error: "managed run not found" })
    } finally {
      await server.close()
    }
  })

  it("streams existing managed run status as an SSE event", async () => {
    const managedRunId = "managed_maaa1234_test1234"
    await writeManagedStatus("completed", managedRunId)
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/run/managed/events/${managedRunId}`,
      })

      assert.equal(response.statusCode, 200)
      assert.match(response.headers["content-type"] as string, /text\/event-stream/u)
      assert.match(response.body, /event: status/u)
      assert.match(response.body, new RegExp(`"managedRunId":"${managedRunId}"`, "u"))
      assert.match(response.body, /"status":"completed"/u)
    } finally {
      await server.close()
    }
  })
})

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"

describe("stage log routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
    await fs.mkdir(path.join(versionDir(), "logs"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "logs", "create_cad_stage_result.json"), JSON.stringify({
      detail: "CAD done",
      stage_name: "create_cad",
      status: "completed",
      time: "2026-01-01T00:00:00.000Z",
    }), "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "conversation-history.json"), JSON.stringify([
      {
        createdAt: 1,
        id: "session-1",
        turns: [
          {
            events: [
              { item: { id: "msg-1", text: "final answer", type: "agent_message" }, type: "item.completed" },
            ],
            id: "turn-1",
            userPrompt: "hello",
          },
        ],
      },
    ]), "utf-8")
  })

  it("reads stage log entries", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/logs/stages?workspaceDir=${encodeURIComponent(versionDir())}&limit=5`,
      })

      assert.equal(response.statusCode, 200)
      assert.ok(response.json().some((entry: { detail?: string }) => entry.detail === "CAD done"))
    } finally {
      await server.close()
    }
  })

  it("adds markdown reports to stage entries and rewrites local image links", async () => {
    await fs.mkdir(path.join(versionDir(), "reports", "images"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "reports", "images", "plot.png"), "png", "utf-8")
    await fs.writeFile(path.join(versionDir(), "reports", "report.md"), [
      "# Report",
      "![plot](images/plot.png)",
      "[notes](notes.txt)",
      "[external](https://example.test/image.png)",
    ].join("\n"), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/logs/stages?workspaceDir=${encodeURIComponent(versionDir())}&limit=10`,
      })
      const reportEntry = response.json().find((entry: { stage_name?: string }) => entry.stage_name === "总结报告")

      assert.equal(response.statusCode, 200)
      assert.equal(reportEntry.status, "completed")
      assert.equal(reportEntry.detail, "reports/report.md")
      assert.match(reportEntry.raw.content, /!\[plot\]\(\/api\/image\?path=/u)
      assert.match(reportEntry.raw.content, /\[notes\]\(notes\.txt\)/u)
      assert.match(reportEntry.raw.content, /\[external\]\(https:\/\/example\.test\/image\.png\)/u)
    } finally {
      await server.close()
    }
  })

  it("normalizes array stage logs, result fields, fallback times, and all markdown report slots", async () => {
    await fs.writeFile(path.join(versionDir(), "logs", "array_stage_result.json"), JSON.stringify([
      {
        result: {
          message: "placement summary",
          ok: true,
          outer_size_mm: [10, 20, 30],
          stats: {
            n_parts: 4,
            n_placed: 3,
            n_unplaced: 1,
            placement_rate: 0.75,
            total_mass: 1.2,
            total_power: 8.5,
          },
        },
        stage_name: "place_components",
        status: "completed",
        timestamp: "2026-01-01T01:00:00.000Z",
      },
      {
        detail: "fallback timestamp",
        payload: { nested: true },
        stage_name: "fallback_time",
        status: "running",
      },
      {
        stage_name: "missing_status",
      },
    ]), "utf-8")
    await fs.writeFile(path.join(versionDir(), "logs", "broken_stage_result.json"), "{bad-json", "utf-8")
    await fs.mkdir(path.join(versionDir(), "reports", "cad_sim_report", "images"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "reports", "modifications.md"), "![absolute](/tmp/plot.png)", "utf-8")
    await fs.writeFile(
      path.join(versionDir(), "reports", "cad_sim_report", "report.md"),
      "![local](images/thermal.svg)\n[anchor](#section)",
      "utf-8",
    )
    await fs.writeFile(path.join(versionDir(), "reports", "cad_sim_report", "images", "thermal.svg"), "<svg />", "utf-8")
    await fs.writeFile(path.join(versionDir(), "reports", "cad_sim_report", "modifications.md"), "plain", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/logs/stages?workspaceDir=${encodeURIComponent(versionDir())}&limit=300`,
      })
      const entries = response.json()
      const placement = entries.find((entry: { stage_name?: string }) => entry.stage_name === "place_components")
      const fallback = entries.find((entry: { stage_name?: string }) => entry.stage_name === "fallback_time")
      const reportTitles = entries.map((entry: { stage_name?: string }) => entry.stage_name)
      const cadReport = entries.find((entry: { stage_name?: string }) => entry.stage_name === "CAD/仿真报告")
      const modifications = entries.find((entry: { stage_name?: string }) => entry.stage_name === "修改建议")

      assert.equal(response.statusCode, 200)
      assert.equal(placement.detail, "placement summary")
      assert.deepEqual(placement.fields, {
        n_parts: "4",
        n_placed: "3",
        n_unplaced: "1",
        ok: "true",
        outer_size_mm: "10, 20, 30",
        placement_rate: "0.75",
        total_mass: "1.2",
        total_power: "8.5",
      })
      assert.equal(placement.time, "2026-01-01T01:00:00.000Z")
      assert.equal(fallback.detail, "fallback timestamp")
      assert.match(fallback.time, /^\d{4}-\d{2}-\d{2}T/u)
      assert.equal(reportTitles.includes("修改建议"), true)
      assert.equal(reportTitles.includes("CAD/仿真报告"), true)
      assert.equal(reportTitles.includes("CAD/仿真修改建议"), true)
      assert.match(cadReport.raw.content, /!\[local\]\(\/api\/image\?path=/u)
      assert.match(cadReport.raw.content, /\[anchor\]\(#section\)/u)
      assert.match(modifications.raw.content, /!\[absolute\]\(\/api\/image\?path=/u)
      assert.equal(entries.some((entry: { stage_name?: string }) => entry.stage_name === "missing_status"), false)
    } finally {
      await server.close()
    }
  })

  it("reads conversation summaries and latest assistant message", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const conversationResponse = await server.inject({
        method: "GET",
        url: `/api/logs/conversation?workspaceDir=${workspaceDir}`,
      })
      assert.equal(conversationResponse.statusCode, 200)
      assert.equal(conversationResponse.json()[0].title, "历史对话")

      const latestResponse = await server.inject({
        method: "GET",
        url: `/api/logs/conversation/latest?workspaceDir=${workspaceDir}`,
      })
      assert.equal(latestResponse.statusCode, 200)
      assert.equal(latestResponse.json().text, "final answer")
    } finally {
      await server.close()
    }
  })

  it("trims conversation history with query limits", async () => {
    await fs.writeFile(path.join(versionDir(), "logs", "conversation-history.json"), JSON.stringify([
      {
        id: "session-old",
        turns: [
          { id: "turn-old", events: [{ item: { id: "old", text: "old" } }] },
        ],
      },
      {
        id: "session-new",
        turns: [
          { id: "turn-1", events: [{ item: { id: "msg-1", text: "one" } }] },
          {
            id: "turn-2",
            events: [
              { item: { id: "msg-2", text: "two" } },
              { item: { id: "msg-3", text: "three" } },
            ],
          },
        ],
      },
    ]), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/logs/conversation?workspaceDir=${encodeURIComponent(versionDir())}&sessionLimit=1&turnLimit=1&eventLimit=1`,
      })
      const entry = response.json()[0]

      assert.equal(response.statusCode, 200)
      assert.equal(entry.detail, "2 sessions · 3 turns")
      assert.equal(entry.raw.sessions.length, 1)
      assert.equal(entry.raw.sessions[0].id, "session-new")
      assert.equal(entry.raw.sessions[0].turns.length, 1)
      assert.equal(entry.raw.sessions[0].turns[0].id, "turn-2")
      assert.deepEqual(entry.raw.sessions[0].turns[0].events, [
        { item: { id: "msg-3", text: "three" } },
      ])
    } finally {
      await server.close()
    }
  })

  it("returns empty conversation results for missing or malformed history", async () => {
    await fs.rm(path.join(versionDir(), "logs", "conversation-history.json"))
    const server = await createTestServer()

    try {
      const missingConversation = await server.inject({
        method: "GET",
        url: `/api/logs/conversation?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(missingConversation.statusCode, 200)
      assert.deepEqual(missingConversation.json(), [])

      const missingLatest = await server.inject({
        method: "GET",
        url: `/api/logs/conversation/latest?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(missingLatest.statusCode, 200)
      assert.deepEqual(missingLatest.json(), { text: null })

      await fs.writeFile(path.join(versionDir(), "logs", "conversation-history.json"), "{bad-json", "utf-8")
      const malformedConversation = await server.inject({
        method: "GET",
        url: `/api/logs/conversation?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(malformedConversation.statusCode, 200)
      assert.deepEqual(malformedConversation.json(), [])

      const malformedLatest = await server.inject({
        method: "GET",
        url: `/api/logs/conversation/latest?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(malformedLatest.statusCode, 200)
      assert.deepEqual(malformedLatest.json(), { text: null })
    } finally {
      await server.close()
    }
  })
})

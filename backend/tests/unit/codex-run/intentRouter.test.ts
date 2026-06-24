import assert from "node:assert/strict"
import { afterEach, describe, it, mock } from "node:test"
import { fallbackRouting, routeManagedRunIntent } from "../../../src/codex-run/intentRouter.js"
import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestLogger } from "../../helpers/testLogger.js"

const THERMAL_WORKFLOW_SKILLS = [
  "planner",
  "workflow-diagram-writer",
  "config-editor",
  "cad-builder",
  "simulation-skill",
]

describe("fallbackRouting", () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it("routes derating workspaces to check skills", () => {
    const result = fallbackRouting({
      input: "检查降额",
      workspaceId: "ws_check",
      workspaceName: "derating",
    })

    assert.equal(result.intent, "check")
    assert.deepEqual(result.managedSkills, ["task-runner"])
    assert.deepEqual(result.selectedSkills, ["compliance"])
    assert.deepEqual(result.skillScopes, ["public", "check"])
    assert.equal(result.source, "fallback")
  })

  it("routes thermal workspaces to the thermal workflow skills", () => {
    const result = fallbackRouting({
      input: "做热仿真",
      workspaceId: "ws_thermal",
    })

    assert.equal(result.intent, "thermal")
    assert.deepEqual(result.selectedSkills, THERMAL_WORKFLOW_SKILLS)
    assert.deepEqual(result.skillScopes, ["public", "thermal"])
  })

  it("routes thermal_catch workspaces to the thermal workflow skills", () => {
    const result = fallbackRouting({
      input: "做新型号热仿真",
      workspaceId: "ws_thermal_catch",
      workspaceName: "thermal_catch",
    })

    assert.equal(result.intent, "thermal")
    assert.deepEqual(result.selectedSkills, THERMAL_WORKFLOW_SKILLS)
    assert.deepEqual(result.skillScopes, ["public", "thermal"])
  })

  it("routes satellite CAD modeling plus thermal simulation to the split CAD workflow", () => {
    const result = fallbackRouting({
      input: "执行卫星的cad建模和热仿真",
      workspaceId: "ws_thermal_catch",
      workspaceName: "thermal_catch",
    })

    assert.equal(result.intent, "thermal")
    assert.deepEqual(result.selectedSkills, THERMAL_WORKFLOW_SKILLS)
    assert.equal(result.selectedSkills.includes("freecad"), false)
    assert.deepEqual(result.skillScopes, ["public", "thermal"])
  })

  it("routes GNC workspaces to the AIGNC orchestrator", () => {
    const result = fallbackRouting({
      input: "设计姿控场景",
      workspaceName: "aignc mission",
    })

    assert.equal(result.intent, "gnc")
    assert.deepEqual(result.selectedSkills, ["aignc-42-orchestrator"])
    assert.deepEqual(result.skillScopes, ["public", "aignc"])
  })

  it("uses the public scope for general requests", () => {
    const result = fallbackRouting({ input: "hello" })

    assert.equal(result.intent, "general")
    assert.deepEqual(result.selectedSkills, [])
    assert.deepEqual(result.skillScopes, ["public"])
  })

  it("routes with the managed prompt and chatModel Responses API settings", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          managedSkills: ["progress-summarizer"],
          selectedSkills: [],
          skillScopes: ["public"],
        }),
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    })

    const config = createTestConfig({
      chatModel: {
        apiKey: "router-chat-key",
        baseUrl: "https://router.example.test/v1/",
        model: "router-model",
      },
    })
    const result = await routeManagedRunIntent({
      input: [{ type: "text", text: "刚才的任务进度怎么样？" }],
    }, {
      config,
      logger: createTestLogger(),
      requestId: "router-test",
    })

    assert.equal(result.source, "codex")
    assert.equal(result.intent, "general")
    assert.deepEqual(result.managedSkills, ["progress-summarizer"])
    assert.deepEqual(result.skillScopes, ["public"])
    assert.equal(calls.length, 1)
    assert.equal(String(calls[0].input), "https://router.example.test/v1/responses")
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer router-chat-key")
    const requestBody = JSON.parse(String(calls[0].init?.body)) as {
      input: string
      max_output_tokens: number
      model: string
    }
    assert.match(requestBody.input, /# Intent Router[\s\S]*刚才的任务进度怎么样？/u)
    assert.deepEqual({
      max_output_tokens: requestBody.max_output_tokens,
      model: requestBody.model,
    }, {
      max_output_tokens: Number(process.env.CODEX_INTENT_ROUTER_OUTPUT_TOKENS ?? 512),
      model: "router-model",
    })
  })

  it("extracts nested Responses API output and normalizes routed skills", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "hidden" }],
        },
        {
          type: "message",
          content: [
            { type: "output_text", text: "prefix" },
            {
              type: "output_text",
              text: JSON.stringify({
                managedSkills: ["task-runner"],
                selectedSkills: [" planner ", "planner", "", "freecad"],
                skillScopes: ["public", "thermal", "thermal"],
              }),
            },
          ],
        },
      ],
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))

    const result = await routeManagedRunIntent({
      input: [{ type: "text", text: "请配置热仿真并运行 FreeCAD" }],
    }, {
      config: createTestConfig(),
      logger: createTestLogger(),
      requestId: "router-nested-output",
    })

    assert.equal(result.source, "codex")
    assert.equal(result.intent, "thermal")
    assert.deepEqual(result.managedSkills, ["task-runner"])
    assert.deepEqual(result.selectedSkills, ["planner", "freecad"])
    assert.deepEqual(result.skillScopes, ["public", "thermal"])
  })

  it("falls back when Responses API output is invalid for routing", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        managedSkills: ["task-runner", "progress-summarizer"],
        selectedSkills: ["should-not-survive"],
        skillScopes: ["public", "thermal", "check"],
      }),
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }))

    const result = await routeManagedRunIntent({
      input: "需要做降额检查",
      workspaceId: "ws_check",
    }, {
      config: createTestConfig(),
      logger: createTestLogger(),
      requestId: "router-invalid-json",
    })

    assert.equal(result.source, "fallback")
    assert.equal(result.intent, "check")
    assert.deepEqual(result.selectedSkills, ["compliance"])
    assert.deepEqual(result.skillScopes, ["public", "check"])
  })

  it("falls back when Responses API requests fail", async () => {
    mock.method(globalThis, "fetch", async () => new Response("upstream unavailable", { status: 503 }))

    const result = await routeManagedRunIntent({
      input: [{ type: "text", text: "姿态控制任务继续执行" }],
      workspaceName: "adcs mission",
    }, {
      config: createTestConfig(),
      logger: createTestLogger(),
      requestId: "router-http-failure",
    })

    assert.equal(result.source, "fallback")
    assert.equal(result.intent, "gnc")
    assert.deepEqual(result.selectedSkills, ["aignc-42-orchestrator"])
  })

  it("skips Responses API routing when the request has no text input", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch should not be called")
    })

    const result = await routeManagedRunIntent({
      input: [{ type: "image", image_url: "data:image/png;base64,AAAA" }],
      workspaceId: "ws_thermal",
    }, {
      config: createTestConfig(),
      logger: createTestLogger(),
      requestId: "router-image-only",
    })

    assert.equal(fetchMock.mock.callCount(), 0)
    assert.equal(result.source, "fallback")
    assert.equal(result.intent, "thermal")
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildCompactResponsesRetryRequest,
  buildNoToolResponsesRetryRequest,
  rewriteResponsesRequestForCompat,
  shouldUseCompactResponsesRequest,
  summarizeResponsesRequestShape,
} from "../../../src/codex-run/responsesCompat.js"

describe("Responses compatibility rewriting", () => {
  it("drops unsupported Codex fields for compatible Responses providers", () => {
    const { body, stats } = rewriteResponsesRequestForCompat({
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "dev" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
      instructions: "long Codex CLI instructions",
      tools: [
        { type: "function", name: "exec_command" },
        { type: "web_search" },
        { type: "function", name: "view_image" },
      ],
    })

    assert.deepEqual(stats, {
      compactedInputItems: 0,
      developerRolesRewritten: 1,
      droppedInstructions: true,
      filteredTools: ["web_search", "view_image"],
      modelOverriddenFrom: null,
      proactiveCompact: false,
      strippedTopLevelFields: [],
      systemMessagesMerged: 0,
      systemMessagesMoved: 0,
    })
    assert.equal((body as { instructions?: unknown }).instructions, undefined)
    assert.equal((body as { input: Array<{ role: string }> }).input[0].role, "system")
    assert.deepEqual((body as { tools: Array<{ name: string }> }).tools.map(tool => tool.name), ["exec_command"])
  })

  it("overrides subagent default models for internal chatModel compatibility", () => {
    const { body, stats } = rewriteResponsesRequestForCompat({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "run" }] },
      ],
      model: "gpt-5.4",
    }, "Qwen3.6")

    const rewritten = body as Record<string, unknown>
    assert.equal(rewritten.model, "Qwen3.6")
    assert.equal(stats.modelOverriddenFrom, "gpt-5.4")
  })

  it("moves rewritten system messages to the beginning of resumed input", () => {
    const { body, stats } = rewriteResponsesRequestForCompat({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "second" }] },
      ],
    })

    assert.equal(stats.developerRolesRewritten, 1)
    assert.equal(stats.systemMessagesMoved, 1)
    assert.equal(stats.systemMessagesMerged, 0)
    assert.deepEqual(
      (body as { input: Array<{ role: string }> }).input.map(item => item.role),
      ["system", "user", "user"],
    )
  })

  it("merges multiple leading system messages for stricter Responses gateways", () => {
    const { body, stats } = rewriteResponsesRequestForCompat({
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev1" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev2" }] },
      ],
    })

    const input = (body as { input: Array<{ content: unknown[]; role: string }> }).input
    assert.equal(stats.developerRolesRewritten, 2)
    assert.equal(stats.systemMessagesMoved, 1)
    assert.equal(stats.systemMessagesMerged, 1)
    assert.deepEqual(input.map(item => item.role), ["system", "user"])
    assert.equal(input[0].content.length, 2)
  })

  it("strips Responses API top-level fields unsupported by the internal gateway", () => {
    const { body, stats } = rewriteResponsesRequestForCompat({
      client_metadata: { request_id: "req-1" },
      include: ["reasoning.encrypted_content"],
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      metadata: { requestId: "req-1" },
      parallel_tool_calls: true,
      prompt_cache_key: "cache-key",
      previous_response_id: "resp_keep",
      reasoning: { effort: "medium" },
      store: true,
      tool_choice: "auto",
      truncation: "auto",
    })

    assert.deepEqual(stats.strippedTopLevelFields, [
      "client_metadata",
      "include",
      "metadata",
      "parallel_tool_calls",
      "prompt_cache_key",
      "reasoning",
      "store",
      "tool_choice",
      "truncation",
    ])
    const rewritten = body as Record<string, unknown>
    assert.equal(rewritten.client_metadata, undefined)
    assert.equal(rewritten.include, undefined)
    assert.equal(rewritten.metadata, undefined)
    assert.equal(rewritten.parallel_tool_calls, undefined)
    assert.equal(rewritten.prompt_cache_key, undefined)
    assert.equal(rewritten.previous_response_id, "resp_keep")
    assert.equal(rewritten.reasoning, undefined)
    assert.equal(rewritten.store, undefined)
    assert.equal(rewritten.tool_choice, undefined)
    assert.equal(rewritten.truncation, undefined)
  })

  it("builds a compact retry request without previous response state", () => {
    const { body, stats } = buildCompactResponsesRetryRequest({
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "old" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
        { type: "function_call_output", call_id: "call_1", output: "tool result" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "new" }] },
      ],
      previous_response_id: "resp_drop",
      tools: [{ type: "function", name: "exec_command" }],
    })

    const rewritten = body as { input: Array<{ role?: string; type: string }>; previous_response_id?: string }
    assert.equal(rewritten.previous_response_id, undefined)
    assert.equal(stats.compactedInputItems, 3)
    assert.deepEqual(stats.strippedTopLevelFields, ["previous_response_id"])
    assert.deepEqual(
      rewritten.input.map(item => item.role ?? item.type),
      ["system", "user"],
    )
  })

  it("builds a no-tool retry request for gateways that reject tool schemas", () => {
    const { body, stats } = buildNoToolResponsesRetryRequest({
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "run" }] },
      ],
      tool_choice: "auto",
      tools: [{ type: "function", name: "exec_command" }],
    })

    const rewritten = body as Record<string, unknown>
    assert.equal(rewritten.tools, undefined)
    assert.equal(rewritten.tool_choice, undefined)
    assert.deepEqual(stats.strippedTopLevelFields, ["tool_choice", "tools"])
  })

  it("summarizes request shape without logging message content", () => {
    const shape = summarizeResponsesRequestShape({
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "secret" }] },
        { type: "function_call_output", call_id: "call_1", output: "secret output" },
      ],
      previous_response_id: "resp_1",
      tools: [
        { type: "function", name: "exec_command" },
        { type: "function", name: "apply_patch" },
      ],
    })

    assert.equal(shape.hasPreviousResponseId, true)
    assert.equal(shape.inputItems, 2)
    assert.deepEqual(shape.inputRoles, { system: 1, "<missing>": 1 })
    assert.deepEqual(shape.inputTypes, { function_call_output: 1, message: 1 })
    assert.deepEqual(shape.contentTypes, { input_text: 1 })
    assert.equal(shape.toolCount, 2)
    assert.deepEqual(shape.toolNames, ["exec_command", "apply_patch"])
  })

  it("selects compact mode proactively for large or tool-heavy request shapes", () => {
    assert.equal(shouldUseCompactResponsesRequest({
      input: Array.from({ length: 18 }, (_, index) => ({
        type: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        content: [{ type: index % 2 === 0 ? "input_text" : "output_text", text: "item" }],
      })),
    }), true)

    assert.equal(shouldUseCompactResponsesRequest({
      input: Array.from({ length: 8 }, (_, index) => ({
        type: "function_call_output",
        call_id: `call_${index}`,
        output: "ok",
      })),
    }), true)

    assert.equal(shouldUseCompactResponsesRequest({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "small" }] },
      ],
    }), false)
  })
})

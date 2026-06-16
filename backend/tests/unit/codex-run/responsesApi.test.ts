import assert from "node:assert/strict"
import { afterEach, describe, it, mock } from "node:test"
import { createResponseText, getResponseOutputText } from "../../../src/codex-run/agentOrchestrator.js"
import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestLogger } from "../../helpers/testLogger.js"

describe("Responses API helpers", () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it("extracts output_text before falling back to nested output content", () => {
    assert.equal(getResponseOutputText({ output_text: " direct text " }), "direct text")
    assert.equal(getResponseOutputText({
      output: [
        { content: [{ text: "first" }, { text: " second " }] },
        { content: [{ text: "" }, { text: "third" }] },
      ],
    }), "first\nsecond\nthird")
    assert.equal(getResponseOutputText({ output: [{ content: [{ noText: true }] }] }), "")
  })

  it("ignores reasoning output blocks when extracting response text", () => {
    assert.equal(getResponseOutputText({
      output: [
        { type: "reasoning", content: [{ text: "hidden chain of thought" }] },
        {
          type: "message",
          content: [
            { type: "reasoning_text", text: "hidden reasoning text" },
            { type: "output_text", text: "visible answer" },
          ],
        },
      ],
    }), "visible answer")
  })

  it("uses reasoning text as a fallback for compatible Responses providers", () => {
    assert.equal(getResponseOutputText({
      output: [
        {
          type: "reasoning",
          content: [
            { type: "reasoning_text", text: " fallback answer " },
          ],
        },
      ],
    }), "fallback answer")
  })

  it("posts trimmed configuration to /responses and returns parsed text", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ output_text: "response answer" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    })

    const config = createTestConfig({
      chatModel: {
        apiKey: "test-chat-key",
        baseUrl: "https://chat.example.test/v1/",
        model: "chat-model",
      },
    })
    const text = await createResponseText({
      config,
      logger: createTestLogger(),
      maxOutputTokens: 123,
      prompt: "hello",
      purpose: "unit-test",
      requestId: "request-1",
      signal: new AbortController().signal,
    })

    assert.equal(text, "response answer")
    assert.equal(calls.length, 1)
    assert.equal(String(calls[0].input), "https://chat.example.test/v1/responses")
    assert.equal(calls[0].init?.method, "POST")
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer test-chat-key")
    assert.equal((calls[0].init?.headers as Record<string, string>)["Content-Type"], "application/json")
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      input: "hello",
      max_output_tokens: 123,
      model: "chat-model",
    })
  })

  it("clips long prompts before sending them to the Responses API", async () => {
    let requestBody: { input: string } | null = null
    mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as { input: string }
      return new Response(JSON.stringify({ output_text: "ok" }), { status: 200 })
    })

    await createResponseText({
      config: createTestConfig(),
      logger: createTestLogger(),
      maxOutputTokens: 10,
      prompt: "x".repeat(20_050),
      purpose: "unit-test",
      signal: new AbortController().signal,
    })

    assert.equal(requestBody?.input.length, 20_000)
  })

  it("throws a detailed error when the Responses API returns a non-2xx status", async () => {
    mock.method(globalThis, "fetch", async () => new Response("bad request body", { status: 400 }))

    await assert.rejects(
      createResponseText({
        config: createTestConfig(),
        logger: createTestLogger(),
        maxOutputTokens: 10,
        prompt: "hello",
        purpose: "unit-test",
        signal: new AbortController().signal,
      }),
      /responses api failed: HTTP 400\nbad request body/u,
    )
  })
})

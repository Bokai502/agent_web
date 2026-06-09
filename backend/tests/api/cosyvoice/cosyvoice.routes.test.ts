import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("cosyvoice routes", () => {
  beforeEach(async () => {
    await resetTestData()
  })

  afterEach(() => {
    mock.restoreAll()
  })

  it("reports configured cosyvoice settings", async () => {
    const config = createTestConfig({
      cosyvoice: {
        apiUrl: "http://127.0.0.1:50001/tts",
        promptText: "prompt",
        promptWav: "/tmp/prompt.wav",
        root: "/tmp/cosyvoice-root",
        ttsMaxTextLength: 12,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "GET", url: "/api/cosyvoice/config" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.endpoint, "http://127.0.0.1:50001/tts")
      assert.equal(body.promptWav, "/tmp/prompt.wav")
      assert.equal(body.outputDir, "/tmp/cosyvoice-root")
      assert.equal(body.maxTextLength, 12)
    } finally {
      await server.close()
    }
  })

  it("serves generated wav files and rejects invalid names", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, "hello.wav"), Buffer.from("RIFF"))
    const server = await createTestServer({ config: createTestConfig({ cosyvoice: { root } }) })

    try {
      const invalid = await server.inject({ method: "GET", url: "/api/cosyvoice/audio/../bad.wav" })
      assert.equal(invalid.statusCode, 404)

      const invalidName = await server.inject({ method: "GET", url: "/api/cosyvoice/audio/bad.txt" })
      assert.equal(invalidName.statusCode, 400)
      assert.deepEqual(invalidName.json(), { error: "invalid audio file name" })

      const missing = await server.inject({ method: "GET", url: "/api/cosyvoice/audio/missing.wav" })
      assert.equal(missing.statusCode, 404)
      assert.deepEqual(missing.json(), { error: "audio file not found" })

      const found = await server.inject({ method: "GET", url: "/api/cosyvoice/audio/hello.wav" })
      assert.equal(found.statusCode, 200)
      assert.equal(found.headers["content-type"], "audio/wav")
      assert.equal(found.body, "RIFF")
    } finally {
      await server.close()
    }
  })

  it("serves pregenerated task accepted audio when available", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({ method: "GET", url: "/api/agent/audio/task-accepted" })

      assert.equal(response.statusCode, 200)
      assert.equal(response.headers["content-type"], "audio/wav")
      assert.equal(response.headers["cache-control"], "public, max-age=86400")
      assert.ok(response.rawPayload.byteLength > 0)
    } finally {
      await server.close()
    }
  })

  it("validates TTS text input", async () => {
    const server = await createTestServer({ config: createTestConfig({ cosyvoice: { ttsMaxTextLength: 4 } }) })

    try {
      const missing = await server.inject({
        method: "POST",
        payload: { text: "" },
        url: "/api/cosyvoice/tts",
      })
      assert.equal(missing.statusCode, 400)
      assert.deepEqual(missing.json(), { error: "text is required" })

      const tooLongTts = await server.inject({
        method: "POST",
        payload: { text: "12345" },
        url: "/api/cosyvoice/tts",
      })
      assert.equal(tooLongTts.statusCode, 413)
      assert.deepEqual(tooLongTts.json(), { error: "text is too long; max 4 characters" })

      const tooLong = await server.inject({
        method: "POST",
        payload: { text: "12345" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(tooLong.statusCode, 413)
      assert.deepEqual(tooLong.json(), { error: "text is too long; max 4 characters" })

      const missingStreamText = await server.inject({
        method: "POST",
        payload: { text: "   " },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(missingStreamText.statusCode, 400)
      assert.deepEqual(missingStreamText.json(), { error: "text is required" })
    } finally {
      await server.close()
    }
  })

  it("writes synthesized TTS audio with sanitized output names", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(Buffer.from("WAVDATA"), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          apiUrl: "http://127.0.0.1:50001/tts",
          promptWav,
          root,
        },
      }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          outputName: "../Voice One",
          promptText: " custom prompt ",
          text: "hello",
        },
        url: "/api/cosyvoice/tts",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.ok, true)
      assert.equal(body.fileName, "Voice_One.wav")
      assert.equal(body.bytes, 7)
      assert.equal(await fs.readFile(path.join(root, "Voice_One.wav"), "utf-8"), "WAVDATA")
      assert.equal(fetchMock.mock.callCount(), 1)
    } finally {
      await server.close()
    }
  })

  it("writes synthesized TTS audio with a generated default output name", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    mock.method(globalThis, "fetch", async () => new Response(Buffer.from("WAVDATA"), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          promptWav,
          root,
        },
      }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          outputName: "   ",
          text: "hello",
        },
        url: "/api/cosyvoice/tts",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.ok, true)
      assert.match(body.fileName, /^cosyvoice_\d{4}-\d{2}-\d{2}T.+\.wav$/u)
      assert.equal(await fs.readFile(path.join(root, body.fileName), "utf-8"), "WAVDATA")
    } finally {
      await server.close()
    }
  })

  it("streams TTS audio from the upstream service and then cache", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(Buffer.from("AUDIO"), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          apiUrl: "http://127.0.0.1:50001/tts",
          promptWav,
          root,
          streamCacheMaxItems: 2,
          streamCacheTtlMs: 60_000,
        },
      }),
    })

    try {
      const first = await server.inject({
        method: "POST",
        payload: { text: "hello" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(first.statusCode, 200)
      assert.equal(first.headers["x-cosyvoice-cache"], "miss")
      assert.equal(first.body, "AUDIO")

      const second = await server.inject({
        method: "POST",
        payload: { text: "hello" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(second.statusCode, 200)
      assert.equal(second.headers["x-cosyvoice-cache"], "hit")
      assert.equal(second.body, "AUDIO")
      assert.equal(fetchMock.mock.callCount(), 1)
    } finally {
      await server.close()
    }
  })

  it("skips stream caching when cache settings disable it", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(Buffer.from("LIVE"), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          apiUrl: "http://127.0.0.1:50001/tts",
          promptWav,
          root,
          streamCacheMaxItems: 0,
          streamCacheTtlMs: 60_000,
        },
      }),
    })

    try {
      for (let index = 0; index < 2; index += 1) {
        const response = await server.inject({
          method: "POST",
          payload: { text: "no-cache-hello" },
          url: "/api/cosyvoice/tts-stream",
        })
        assert.equal(response.statusCode, 200)
        assert.equal(response.headers["x-cosyvoice-cache"], "miss")
        assert.equal(response.body, "LIVE")
      }
      assert.equal(fetchMock.mock.callCount(), 2)
    } finally {
      await server.close()
    }
  })

  it("evicts the oldest stream cache item when the cache is full", async () => {
    const root = path.join(TEST_DATA_ROOT, "cosyvoice")
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(Buffer.from(`LIVE-${fetchMock.mock.callCount()}`), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          apiUrl: "http://127.0.0.1:50001/tts-evict",
          promptWav,
          root,
          streamCacheMaxItems: 1,
          streamCacheTtlMs: 60_000,
        },
      }),
    })

    try {
      const firstA = await server.inject({
        method: "POST",
        payload: { text: "cache-a" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(firstA.statusCode, 200)
      assert.equal(firstA.headers["x-cosyvoice-cache"], "miss")
      assert.equal(firstA.body, "LIVE-0")

      const firstB = await server.inject({
        method: "POST",
        payload: { text: "cache-b" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(firstB.statusCode, 200)
      assert.equal(firstB.headers["x-cosyvoice-cache"], "miss")
      assert.equal(firstB.body, "LIVE-1")

      const secondA = await server.inject({
        method: "POST",
        payload: { text: "cache-a" },
        url: "/api/cosyvoice/tts-stream",
      })
      assert.equal(secondA.statusCode, 200)
      assert.equal(secondA.headers["x-cosyvoice-cache"], "miss")
      assert.equal(secondA.body, "LIVE-2")
      assert.equal(fetchMock.mock.callCount(), 3)
    } finally {
      await server.close()
    }
  })

  it("surfaces upstream TTS failures", async () => {
    const promptWav = path.join(TEST_DATA_ROOT, "prompt.wav")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(promptWav, Buffer.from("prompt"))
    mock.method(globalThis, "fetch", async () => new Response("bad upstream", { status: 502 }))
    const server = await createTestServer({
      config: createTestConfig({ cosyvoice: { promptWav, root: path.join(TEST_DATA_ROOT, "cosyvoice") } }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "hello" },
        url: "/api/cosyvoice/tts",
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /cosyvoice upstream failed: HTTP 502/u)
    } finally {
      await server.close()
    }
  })

  it("surfaces prompt wav read failures before calling the upstream service", async () => {
    const missingPromptWav = path.join(TEST_DATA_ROOT, "missing-prompt.wav")
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(Buffer.from("unused"), { status: 200 }))
    const server = await createTestServer({
      config: createTestConfig({
        cosyvoice: {
          promptWav: missingPromptWav,
          root: path.join(TEST_DATA_ROOT, "cosyvoice"),
        },
      }),
    })

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "hello" },
        url: "/api/cosyvoice/tts-stream",
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /missing-prompt\.wav/u)
      assert.equal(fetchMock.mock.callCount(), 0)
    } finally {
      await server.close()
    }
  })
})

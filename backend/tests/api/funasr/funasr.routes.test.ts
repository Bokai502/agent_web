import assert from "node:assert/strict"
import http from "node:http"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { resetTestData } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("funasr routes", () => {
  beforeEach(async () => {
    await resetTestData()
  })

  async function createRemoteTranscribeServer(handler: (req: http.IncomingMessage, body: Buffer) => { status?: number; body: unknown }) {
    const requests: Array<{ body: Buffer; headers: http.IncomingHttpHeaders; method: string | undefined; url: string | undefined }> = []
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", chunk => chunks.push(Buffer.from(chunk)))
      req.on("end", () => {
        const body = Buffer.concat(chunks)
        requests.push({ body, headers: req.headers, method: req.method, url: req.url })
        const result = handler(req, body)
        res.writeHead(result.status ?? 200, { "content-type": "application/json" })
        res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.equal(typeof address, "object")
    assert(address)
    return {
      requests,
      url: `http://127.0.0.1:${address.port}/v1/audio/transcriptions`,
      close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    }
  }

  it("reports configured model metadata", async () => {
    const config = createTestConfig({
      funasr: {
        apiUrl: null,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "GET", url: "/api/funasr/models" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.selected, "funasr-sensevoice")
      assert.equal(body.apiUrl, null)
    } finally {
      await server.close()
    }
  })

  it("reports remote transcription service metadata when configured", async () => {
    const config = createTestConfig({
      funasr: {
        apiUrl: "http://127.0.0.1:18080/v1/audio/transcriptions",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "GET", url: "/api/funasr/models" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.selected, "funasr-sensevoice")
      assert.equal(body.apiUrl, "http://127.0.0.1:18080/v1/audio/transcriptions")
    } finally {
      await server.close()
    }
  })

  it("validates raw audio uploads", async () => {
    const server = await createTestServer()

    try {
      const missingBytes = await server.inject({
        method: "POST",
        payload: { text: "not audio" },
        url: "/api/funasr/transcribe",
      })
      assert.equal(missingBytes.statusCode, 400)
      assert.deepEqual(missingBytes.json(), { error: "expected raw audio bytes" })

      const emptyAudio = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.alloc(0),
        url: "/api/funasr/transcribe",
      })
      assert.equal(emptyAudio.statusCode, 400)
      assert.deepEqual(emptyAudio.json(), { error: "audio is empty" })
    } finally {
      await server.close()
    }
  })

  it("validates funasr language before calling the remote service", async () => {
    const config = createTestConfig({
      funasr: {
        apiUrl: "http://127.0.0.1:9/v1/audio/transcriptions",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/wav",
          "x-funasr-language": "../bad",
        },
        method: "POST",
        payload: Buffer.from("wav"),
        url: "/api/funasr/transcribe",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "invalid funasr language" })
    } finally {
      await server.close()
    }
  })

  it("returns service unavailable when the remote funasr API is not configured", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav"),
        url: "/api/funasr/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.equal(body.error, "funasr apiUrl is not configured")
    } finally {
      await server.close()
    }
  })

  it("forwards audio to the remote transcription API and returns transcript metadata", async () => {
    const remote = await createRemoteTranscribeServer((_req, body) => {
      assert.match(body.toString("utf-8"), /name="language"\r\n\r\nauto/u)
      assert.match(body.toString("utf-8"), /name="response_format"\r\n\r\njson/u)
      assert.match(body.toString("utf-8"), /wav-audio/u)
      return { body: { text: "远程识别文本" } }
    })
    const server = await createTestServer({
      config: createTestConfig({
        funasr: {
          apiUrl: remote.url,
        },
      }),
    })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/wav",
        },
        method: "POST",
        payload: Buffer.from("wav-audio"),
        url: "/api/funasr/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.deepEqual(body, {
        language: "zh-en",
        model: "funasr-sensevoice",
        text: "远程识别文本",
        funasrLanguage: "zh",
      })
      assert.equal(remote.requests.length, 1)
      assert.equal(remote.requests[0]?.method, "POST")
      assert.equal(remote.requests[0]?.url, "/v1/audio/transcriptions")
    } finally {
      await server.close()
      await remote.close()
    }
  })

  it("passes explicit language through to the remote transcription API", async () => {
    const remote = await createRemoteTranscribeServer((_req, body) => {
      assert.match(body.toString("utf-8"), /name="language"\r\n\r\nen-us/u)
      assert.match(body.toString("utf-8"), /filename="audio\.mp3"/u)
      return { body: { text: "english transcript" } }
    })
    const server = await createTestServer({
      config: createTestConfig({
        funasr: {
          apiUrl: remote.url,
        },
      }),
    })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/mpeg",
          "x-funasr-language": "en-us",
        },
        method: "POST",
        payload: Buffer.from("mp3-audio"),
        url: "/api/funasr/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.language, "en-us")
      assert.equal(body.funasrLanguage, "en-us")
      assert.equal(body.text, "english transcript")
    } finally {
      await server.close()
      await remote.close()
    }
  })

  it("returns remote transcription failures as server errors", async () => {
    const remote = await createRemoteTranscribeServer(() => ({ status: 502, body: { detail: "remote failed" } }))
    const server = await createTestServer({
      config: createTestConfig({
        funasr: {
          apiUrl: remote.url,
        },
      }),
    })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav-audio"),
        url: "/api/funasr/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.match(body.error, /remote funasr service returned 502/u)
    } finally {
      await server.close()
      await remote.close()
    }
  })

  it("rejects empty Codex text requests", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "   " },
        url: "/api/funasr/codex",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "text is required" })
    } finally {
      await server.close()
    }
  })

  it("dispatches Codex text requests and returns managed errors", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "send this to codex" },
        url: "/api/funasr/codex",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.match(body.codexResponse, /^回答生成失败：/u)
      assert.match(body.spokenSummary, /^回答生成失败：/u)
      assert.equal(body.status, "failed")
      assert.equal(body.routing.skillScopes[0], "public")
      assert.match(body.managedRunId, /^managed_/u)
      assert.match(body.sessionId, /^managed_session_/u)
      assert.match(body.turnId, /^managed_turn_/u)
      assert.equal(body.workspaceDir, null)
      assert.equal(body.workspaceId, null)
    } finally {
      await server.close()
    }
  })
})

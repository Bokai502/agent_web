import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("whisper routes", () => {
  beforeEach(async () => {
    await resetTestData()
  })

  async function writeExecutable(filePath: string, content: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf-8")
    await fs.chmod(filePath, 0o755)
  }

  it("reports configured model metadata", async () => {
    const config = createTestConfig({
      whisper: {
        bin: "/tmp/test-whisper-bin",
        cudaVisibleDevices: "2",
        defaultLanguage: "auto",
        ffmpegBin: "/tmp/test-ffmpeg",
        modelPath: "/tmp/test-whisper-model.bin",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "GET", url: "/api/whisper/models" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.selected, "large-v3-turbo")
      assert.equal(body.modelPath, "/tmp/test-whisper-model.bin")
      assert.equal(body.whisperBin, "/tmp/test-whisper-bin")
      assert.equal(body.ffmpegBin, "/tmp/test-ffmpeg")
      assert.equal(body.cudaVisibleDevices, "2")
      assert.equal(body.defaultLanguage, "auto")
    } finally {
      await server.close()
    }
  })

  it("falls back to zh when the configured default whisper language is invalid", async () => {
    const config = createTestConfig({
      whisper: {
        bin: "/tmp/test-whisper-bin",
        defaultLanguage: "../bad",
        ffmpegBin: "/tmp/test-ffmpeg",
        modelPath: "/tmp/test-whisper-model.bin",
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({ method: "GET", url: "/api/whisper/models" })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.defaultLanguage, "zh")
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
        url: "/api/whisper/transcribe",
      })
      assert.equal(missingBytes.statusCode, 400)
      assert.deepEqual(missingBytes.json(), { error: "expected raw audio bytes" })

      const emptyAudio = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.alloc(0),
        url: "/api/whisper/transcribe",
      })
      assert.equal(emptyAudio.statusCode, 400)
      assert.deepEqual(emptyAudio.json(), { error: "audio is empty" })
    } finally {
      await server.close()
    }
  })

  it("validates whisper language before dependency execution", async () => {
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    const config = createTestConfig({
      whisper: {
        bin: "/bin/true",
        ffmpegBin: "/bin/true",
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/wav",
          "x-whisper-language": "../bad",
        },
        method: "POST",
        payload: Buffer.from("wav"),
        url: "/api/whisper/transcribe",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "invalid whisper language" })
    } finally {
      await server.close()
    }
  })

  it("returns service unavailable when the whisper binary is missing", async () => {
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    const config = createTestConfig({
      whisper: {
        bin: path.join(TEST_DATA_ROOT, "missing-whisper"),
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.match(body.error, /whisper\.cpp binary not found/u)
    } finally {
      await server.close()
    }
  })

  it("returns service unavailable when the whisper model is missing", async () => {
    const whisperBin = path.join(TEST_DATA_ROOT, "bin", "fake-whisper")
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "exit 0",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        modelPath: path.join(TEST_DATA_ROOT, "missing-model.bin"),
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.match(body.error, /whisper model not found/u)
    } finally {
      await server.close()
    }
  })

  it("returns service unavailable when ffmpeg is missing for non-wav audio", async () => {
    const whisperBin = path.join(TEST_DATA_ROOT, "bin", "fake-whisper")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "exit 0",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        ffmpegBin: path.join(TEST_DATA_ROOT, "missing-ffmpeg"),
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/ogg" },
        method: "POST",
        payload: Buffer.from("ogg"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 503)
      assert.match(body.error, /ffmpeg not found/u)
    } finally {
      await server.close()
    }
  })

  it("converts non-wav audio, runs whisper, and returns transcript metadata", async () => {
    const binDir = path.join(TEST_DATA_ROOT, "bin")
    const whisperBin = path.join(binDir, "fake-whisper")
    const ffmpegBin = path.join(binDir, "fake-ffmpeg")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(ffmpegBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      "exit 0",
      "",
    ].join("\n"))
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      "out=\"\"",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"-of\" ]; then",
      "    shift",
      "    out=\"$1\"",
      "  fi",
      "  shift",
      "done",
      "printf 'transcript from file\\n' > \"${out}.txt\"",
      "printf '[00:00.000 --> 00:01.000] transcript from stdout\\n'",
      "exit 0",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        cudaVisibleDevices: "7",
        defaultLanguage: "zh-en",
        ffmpegBin,
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/ogg" },
        method: "POST",
        payload: Buffer.from("ogg-audio"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.deepEqual(body, {
        language: "zh-en",
        model: "large-v3-turbo",
        text: "transcript from file",
        whisperLanguage: "zh",
      })
    } finally {
      await server.close()
    }
  })

  it("uses mp3 upload extensions and passes explicit whisper language arguments", async () => {
    const binDir = path.join(TEST_DATA_ROOT, "bin")
    const markerPath = path.join(TEST_DATA_ROOT, "whisper-args.txt")
    const whisperBin = path.join(binDir, "fake-whisper")
    const ffmpegBin = path.join(binDir, "fake-ffmpeg")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(ffmpegBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      "for arg in \"$@\"; do",
      "  if [[ \"$arg\" == *.mp3 ]]; then touch \"${arg}.seen\"; fi",
      "done",
      "out=\"${@: -1}\"",
      "printf 'wav' > \"$out\"",
      "exit 0",
      "",
    ].join("\n"))
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      `printf '%s\\n' "$@" > ${JSON.stringify(markerPath)}`,
      "out=\"\"",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"-of\" ]; then",
      "    shift",
      "    out=\"$1\"",
      "  fi",
      "  shift",
      "done",
      "printf 'english transcript\\n' > \"${out}.txt\"",
      "exit 0",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        ffmpegBin,
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/mpeg",
          "x-whisper-language": "en-us",
        },
        method: "POST",
        payload: Buffer.from("mp3-audio"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()
      const args = await fs.readFile(markerPath, "utf-8")

      assert.equal(response.statusCode, 200)
      assert.equal(body.language, "en-us")
      assert.equal(body.whisperLanguage, "en-us")
      assert.equal(body.text, "english transcript")
      assert.match(args, /^-m\n/u)
      assert.match(args, /\n-l\nen-us\n/u)
      assert.match(args, /audio\.wav/u)
    } finally {
      await server.close()
    }
  })

  it("uses m4a upload extensions and omits language arguments for auto language", async () => {
    const binDir = path.join(TEST_DATA_ROOT, "bin")
    const markerPath = path.join(TEST_DATA_ROOT, "whisper-auto-args.txt")
    const ffmpegMarkerPath = path.join(TEST_DATA_ROOT, "ffmpeg-args.txt")
    const whisperBin = path.join(binDir, "fake-whisper")
    const ffmpegBin = path.join(binDir, "fake-ffmpeg")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(ffmpegBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      `printf '%s\\n' "$@" > ${JSON.stringify(ffmpegMarkerPath)}`,
      "out=\"${@: -1}\"",
      "printf 'wav' > \"$out\"",
      "exit 0",
      "",
    ].join("\n"))
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      `printf '%s\\n' "$@" > ${JSON.stringify(markerPath)}`,
      "out=\"\"",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"-of\" ]; then",
      "    shift",
      "    out=\"$1\"",
      "  fi",
      "  shift",
      "done",
      "printf 'auto transcript\\n' > \"${out}.txt\"",
      "exit 0",
      "",
    ].join("\n"))
    const server = await createTestServer({
      config: createTestConfig({
        whisper: {
          bin: whisperBin,
          defaultLanguage: "en",
          ffmpegBin,
          modelPath,
        },
      }),
    })

    try {
      const response = await server.inject({
        headers: {
          "content-type": "audio/mp4",
          "x-whisper-language": "auto",
        },
        method: "POST",
        payload: Buffer.from("mp4-audio"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()
      const whisperArgs = await fs.readFile(markerPath, "utf-8")
      const ffmpegArgs = await fs.readFile(ffmpegMarkerPath, "utf-8")

      assert.equal(response.statusCode, 200)
      assert.equal(body.language, "auto")
      assert.equal(body.whisperLanguage, "auto")
      assert.equal(body.text, "auto transcript")
      assert.doesNotMatch(whisperArgs, /\n-l\n/u)
      assert.match(ffmpegArgs, /input\.m4a/u)
    } finally {
      await server.close()
    }
  })

  it("uses uploaded wav audio directly and falls back to whisper stdout text", async () => {
    const binDir = path.join(TEST_DATA_ROOT, "bin")
    const whisperBin = path.join(binDir, "fake-whisper")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    const markerPath = path.join(TEST_DATA_ROOT, "ffmpeg-was-called")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      "printf '[00:00.000 --> 00:01.000] stdout only transcript\\n'",
      "exit 0",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        defaultLanguage: "auto",
        ffmpegBin: markerPath,
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav-audio"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.deepEqual(body, {
        language: "auto",
        model: "large-v3-turbo",
        text: "stdout only transcript",
        whisperLanguage: "auto",
      })
      await assert.rejects(fs.access(markerPath))
    } finally {
      await server.close()
    }
  })

  it("returns transcription command failures as server errors", async () => {
    const binDir = path.join(TEST_DATA_ROOT, "bin")
    const whisperBin = path.join(binDir, "fake-whisper")
    const modelPath = path.join(TEST_DATA_ROOT, "whisper-model.bin")
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    await fs.writeFile(modelPath, "model", "utf-8")
    await writeExecutable(whisperBin, [
      "#!/usr/bin/env bash",
      "if [ \"$1\" = \"-version\" ]; then exit 0; fi",
      "printf 'whisper failed loudly\\n' >&2",
      "exit 3",
      "",
    ].join("\n"))
    const config = createTestConfig({
      whisper: {
        bin: whisperBin,
        modelPath,
      },
    })
    const server = await createTestServer({ config })

    try {
      const response = await server.inject({
        headers: { "content-type": "audio/wav" },
        method: "POST",
        payload: Buffer.from("wav-audio"),
        url: "/api/whisper/transcribe",
      })
      const body = response.json()

      assert.equal(response.statusCode, 500)
      assert.deepEqual(body, { error: "whisper failed loudly\n" })
    } finally {
      await server.close()
    }
  })

  it("rejects empty Codex text requests", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "   " },
        url: "/api/whisper/codex",
      })

      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "text is required" })
    } finally {
      await server.close()
    }
  })

  it("dispatches Codex text requests and returns managed fallback responses", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: { text: "send this to codex" },
        url: "/api/whisper/codex",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.codexResponse, "这个问题暂时没有生成有效回答。")
      assert.equal(body.spokenSummary, "这个问题暂时没有生成有效回答。")
      assert.equal(body.status, "partial")
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

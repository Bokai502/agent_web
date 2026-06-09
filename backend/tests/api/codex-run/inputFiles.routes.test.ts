import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT } from "../../helpers/resetTestData.js"

describe("codex input file routes", () => {
  it("rejects unsupported or empty image uploads", async () => {
    const server = await createTestServer()

    try {
      const unsupported = await server.inject({
        method: "POST",
        payload: {
          dataBase64: Buffer.from("image").toString("base64"),
          mimeType: "text/plain",
          name: "note.txt",
        },
        url: "/api/run/input-files",
      })
      assert.equal(unsupported.statusCode, 400)
      assert.deepEqual(unsupported.json(), { error: "supported image data is required" })

      const empty = await server.inject({
        method: "POST",
        payload: {
          dataBase64: "",
          mimeType: "image/png",
          name: "image.png",
        },
        url: "/api/run/input-files",
      })
      assert.equal(empty.statusCode, 400)
      assert.deepEqual(empty.json(), { error: "supported image data is required" })

      const invalidBase64 = await server.inject({
        method: "POST",
        payload: {
          dataBase64: "!!!!",
          mimeType: "image/webp",
          name: "broken.webp",
        },
        url: "/api/run/input-files",
      })
      assert.equal(invalidBase64.statusCode, 400)
      assert.deepEqual(invalidBase64.json(), { error: "image must be between 1 byte and 20 MB" })
    } finally {
      await server.close()
    }
  })

  it("stores image uploads in a sanitized temporary path", async () => {
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    const previousTmpdir = process.env.TMPDIR
    process.env.TMPDIR = TEST_DATA_ROOT
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          dataBase64: Buffer.from("png-bytes").toString("base64"),
          mimeType: "image/png",
          name: "../Sketch 1",
        },
        url: "/api/run/input-files",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.type, "local_image")
      assert.equal(path.basename(body.path).includes(".."), false)
      assert.equal(body.path.endsWith("-Sketch_1.png"), true)
      assert.equal(await fs.readFile(body.path, "utf-8"), "png-bytes")
    } finally {
      if (previousTmpdir === undefined) {
        delete process.env.TMPDIR
      } else {
        process.env.TMPDIR = previousTmpdir
      }
      await server.close()
    }
  })

  it("uses a default sanitized name and extension when upload names are absent", async () => {
    await fs.mkdir(TEST_DATA_ROOT, { recursive: true })
    const previousTmpdir = process.env.TMPDIR
    process.env.TMPDIR = TEST_DATA_ROOT
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "POST",
        payload: {
          dataBase64: Buffer.from("gif-bytes").toString("base64"),
          mimeType: "image/gif",
        },
        url: "/api/run/input-files",
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.type, "local_image")
      assert.match(path.basename(body.path), /-image\.gif$/u)
      assert.equal(await fs.readFile(body.path, "utf-8"), "gif-bytes")
    } finally {
      if (previousTmpdir === undefined) {
        delete process.env.TMPDIR
      } else {
        process.env.TMPDIR = previousTmpdir
      }
      await server.close()
    }
  })
})

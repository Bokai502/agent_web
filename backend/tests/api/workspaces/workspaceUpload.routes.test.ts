import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

function userRoot() {
  return path.join(TEST_DATA_ROOT, "users", "default")
}

async function createWorkspace(name = "upload_case") {
  const workspaceDir = path.join(userRoot(), name)
  await fs.mkdir(path.join(workspaceDir, "00_inputs"), { recursive: true })
  return workspaceDir
}

function multipartBody(parts: Array<{ content: string; filename: string; name: string; omitType?: boolean; type?: string }>) {
  const boundary = `----open-codex-test-${Date.now()}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`))
    if (!part.omitType) chunks.push(Buffer.from(`Content-Type: ${part.type ?? "application/octet-stream"}\r\n`))
    chunks.push(Buffer.from("\r\n"))
    chunks.push(Buffer.from(part.content))
    chunks.push(Buffer.from("\r\n"))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

describe("workspace upload routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await fs.mkdir(userRoot(), { recursive: true })
  })

  it("uploads files into a workspace target directory with sanitized names", async () => {
    const workspaceDir = await createWorkspace()
    const upload = multipartBody([
      { content: "hello", filename: "../Report 1.txt", name: "file", type: "text/plain" },
    ])
    const server = await createTestServer()

    try {
      const response = await server.inject({
        headers: { "content-type": upload.contentType },
        method: "POST",
        payload: upload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}&targetDir=${encodeURIComponent("00_inputs/new data")}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.workspaceDir, workspaceDir)
      assert.equal(body.targetDir, "00_inputs/new data")
      assert.equal(body.files.length, 1)
      assert.equal(body.files[0].name, "Report 1.txt")
      assert.equal(body.files[0].relativePath, "00_inputs/new data/Report 1.txt")
      assert.equal(body.files[0].mimeType, "text/plain")
      assert.equal(body.files[0].size, 5)
      assert.equal(await fs.readFile(path.join(workspaceDir, body.files[0].relativePath), "utf-8"), "hello")
    } finally {
      await server.close()
    }
  })

  it("deduplicates uploaded file names", async () => {
    const workspaceDir = await createWorkspace()
    await fs.writeFile(path.join(workspaceDir, "00_inputs", "same.txt"), "existing", "utf-8")
    const upload = multipartBody([
      { content: "new", filename: "same.txt", name: "file", type: "text/plain" },
    ])
    const server = await createTestServer()

    try {
      const response = await server.inject({
        headers: { "content-type": upload.contentType },
        method: "POST",
        payload: upload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.files[0].name, "same (1).txt")
      assert.equal(body.files[0].relativePath, "00_inputs/same (1).txt")
      assert.equal(await fs.readFile(path.join(workspaceDir, "00_inputs", "same.txt"), "utf-8"), "existing")
      assert.equal(await fs.readFile(path.join(workspaceDir, "00_inputs", "same (1).txt"), "utf-8"), "new")
    } finally {
      await server.close()
    }
  })

  it("normalizes root and Windows-style upload targets and falls back for unsafe file names", async () => {
    const workspaceDir = await createWorkspace()
    const rootUpload = multipartBody([
      { content: "root", filename: "", name: "file", omitType: true },
    ])
    const nestedUpload = multipartBody([
      { content: "nested", filename: "C:\\temp\\nested.txt", name: "file", type: "text/plain" },
    ])
    const server = await createTestServer()

    try {
      const rootResponse = await server.inject({
        headers: { "content-type": rootUpload.contentType },
        method: "POST",
        payload: rootUpload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}&targetDir=/`,
      })
      const rootBody = rootResponse.json()

      assert.equal(rootResponse.statusCode, 200)
      assert.equal(rootBody.targetDir, "")
      assert.equal(rootBody.files[0].name, "upload")
      assert.equal(rootBody.files[0].relativePath, "upload")
      assert.equal(rootBody.files[0].mimeType, "text/plain")
      assert.equal(await fs.readFile(path.join(workspaceDir, "upload"), "utf-8"), "root")

      const nestedResponse = await server.inject({
        headers: { "content-type": nestedUpload.contentType },
        method: "POST",
        payload: nestedUpload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}&targetDir=${encodeURIComponent("\\00_inputs\\nested\\")}`,
      })
      const nestedBody = nestedResponse.json()

      assert.equal(nestedResponse.statusCode, 200)
      assert.equal(nestedBody.targetDir, "00_inputs/nested")
      assert.equal(nestedBody.files[0].name, "nested.txt")
      assert.equal(nestedBody.files[0].relativePath, "00_inputs/nested/nested.txt")
      assert.equal(await fs.readFile(path.join(workspaceDir, "00_inputs", "nested", "nested.txt"), "utf-8"), "nested")
    } finally {
      await server.close()
    }
  })

  it("rejects uploads when all deduplicated file names are exhausted", async () => {
    const workspaceDir = await createWorkspace()
    await Promise.all(
      Array.from({ length: 1000 }, (_, index) => {
        const fileName = index === 0 ? "same.txt" : `same (${index}).txt`
        return fs.writeFile(path.join(workspaceDir, "00_inputs", fileName), "existing", "utf-8")
      }),
    )
    const upload = multipartBody([
      { content: "new", filename: "same.txt", name: "file", type: "text/plain" },
    ])
    const server = await createTestServer()

    try {
      const response = await server.inject({
        headers: { "content-type": upload.contentType },
        method: "POST",
        payload: upload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })

      assert.equal(response.statusCode, 409)
      assert.deepEqual(response.json(), { error: "too many files with the same name" })
    } finally {
      await server.close()
    }
  })

  it("rejects empty uploads and target directory traversal", async () => {
    const workspaceDir = await createWorkspace()
    const emptyUpload = multipartBody([])
    const server = await createTestServer()

    try {
      const empty = await server.inject({
        headers: { "content-type": emptyUpload.contentType },
        method: "POST",
        payload: emptyUpload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}`,
      })
      assert.equal(empty.statusCode, 400)
      assert.deepEqual(empty.json(), { error: "at least one file is required" })

      const traversalUpload = multipartBody([
        { content: "bad", filename: "bad.txt", name: "file", type: "text/plain" },
      ])
      const traversal = await server.inject({
        headers: { "content-type": traversalUpload.contentType },
        method: "POST",
        payload: traversalUpload.body,
        url: `/api/workspace/files/upload?workspaceDir=${encodeURIComponent(workspaceDir)}&targetDir=../outside`,
      })
      assert.equal(traversal.statusCode, 400)
      assert.deepEqual(traversal.json(), { error: "targetDir must stay inside workspaceDir" })
    } finally {
      await server.close()
    }
  })
})

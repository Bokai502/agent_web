import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createManifestFixture, installNoopWorkspaceCommands, versionDir } from "../../helpers/manifestFixture.js"
import { resetTestData } from "../../helpers/resetTestData.js"
import { createTestConfig } from "../../helpers/testConfig.js"

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

describe("workspace data routes", () => {
  beforeEach(async () => {
    await resetTestData()
    await installNoopWorkspaceCommands()
    await createManifestFixture()
    await fs.writeFile(path.join(versionDir(), "00_inputs", "notes.txt"), "hello workspace", "utf-8")
    await fs.writeFile(path.join(versionDir(), "00_inputs", "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await fs.writeFile(path.join(versionDir(), "00_inputs", "binary.bin"), Buffer.from([0, 1, 2, 3]))
    await writeJson(path.join(versionDir(), "component_info", "geom_component_info.json"), {
      components: [{ id: "P001" }],
      schema_version: "component_info/1.0",
    })
    await writeJson(path.join(versionDir(), "00_inputs", "bom_component_info.json"), {
      bom_id: "bom-1",
      components: [{ component_id: "P001" }],
      matched_records: 1,
      missing_records: 0,
      schema_version: "bom/1.0",
      total_records: 1,
    })
    await writeJson(path.join(versionDir(), "logs", "progress.json"), {
      progress_percentages: { create_cad: 100 },
      status: "completed",
    })
  })

  it("reads workspace file tree, file content, text file, and text chunks", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const treeResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/tree?workspaceDir=${workspaceDir}`,
      })
      assert.equal(treeResponse.statusCode, 200)
      assert.ok(treeResponse.json().entries.some((entry: { name?: string }) => entry.name === "00_inputs"))

      const contentResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/notes.txt")}`,
      })
      assert.equal(contentResponse.statusCode, 200)
      assert.equal(contentResponse.json().content, "hello workspace")

      const textResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/notes.txt")}`,
      })
      assert.equal(textResponse.statusCode, 200)
      assert.equal(textResponse.json().content, "hello workspace")

      const chunkResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/notes.txt")}&offset=6&length=9`,
      })
      assert.equal(chunkResponse.statusCode, 200)
      assert.equal(Buffer.from(chunkResponse.json().contentBase64, "base64").toString("utf-8"), "workspace")

      const imageResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/image.png")}`,
      })
      assert.equal(imageResponse.statusCode, 200)
      assert.equal(imageResponse.json().type, "image")
      assert.equal(Buffer.from(imageResponse.json().contentBase64, "base64").toString("hex"), "89504e47")

      const binaryResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/binary.bin")}`,
      })
      assert.equal(binaryResponse.statusCode, 200)
      assert.equal(binaryResponse.json().type, "binary")
      assert.equal(binaryResponse.json().previewable, false)
    } finally {
      await server.close()
    }
  })

  it("handles nested file trees, missing files, and text chunk bounds", async () => {
    await fs.mkdir(path.join(versionDir(), "00_inputs", "nested"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "00_inputs", "nested", "child.txt"), "child", "utf-8")
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const nestedTree = await server.inject({
        method: "GET",
        url: `/api/workspace/files/tree?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/nested")}`,
      })
      assert.equal(nestedTree.statusCode, 200)
      assert.equal(nestedTree.json().relativePath, "00_inputs/nested")
      assert.deepEqual(nestedTree.json().entries.map((entry: { name: string }) => entry.name), ["child.txt"])

      const missingDir = await server.inject({
        method: "GET",
        url: `/api/workspace/files/tree?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/missing")}`,
      })
      assert.equal(missingDir.statusCode, 404)
      assert.deepEqual(missingDir.json(), { error: "directory not found" })

      const missingFile = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/missing.txt")}`,
      })
      assert.equal(missingFile.statusCode, 404)
      assert.deepEqual(missingFile.json(), { error: "file not found" })

      const missingRelativePath = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingRelativePath.statusCode, 400)
      assert.deepEqual(missingRelativePath.json(), { error: "relativePath is required" })

      const beyondEndChunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/notes.txt")}&offset=999&length=10`,
      })
      assert.equal(beyondEndChunk.statusCode, 200)
      assert.equal(beyondEndChunk.json().contentBase64, "")
      assert.equal(beyondEndChunk.json().complete, true)
      assert.equal(beyondEndChunk.json().nextOffset, beyondEndChunk.json().size)
    } finally {
      await server.close()
    }
  })

  it("truncates large directory listings and ignores hidden entries", async () => {
    const manyDir = path.join(versionDir(), "00_inputs", "many")
    await fs.mkdir(manyDir, { recursive: true })
    await fs.writeFile(path.join(manyDir, ".hidden.txt"), "hidden", "utf-8")
    await Promise.all(Array.from({ length: 505 }, (_, index) =>
      fs.writeFile(path.join(manyDir, `item-${String(index).padStart(3, "0")}.txt`), String(index), "utf-8")
    ))
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/files/tree?workspaceDir=${encodeURIComponent(versionDir())}&relativePath=${encodeURIComponent("00_inputs/many")}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.truncated, true)
      assert.equal(body.entries.length, 500)
      assert.equal(body.entries.some((entry: { name: string }) => entry.name === ".hidden.txt"), false)
    } finally {
      await server.close()
    }
  })

  it("detects additional image mime types and caps text chunk length", async () => {
    await fs.writeFile(path.join(versionDir(), "00_inputs", "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff]))
    await fs.writeFile(path.join(versionDir(), "00_inputs", "photo-large.jpeg"), Buffer.from([0xff, 0xd8, 0xee]))
    await fs.writeFile(path.join(versionDir(), "00_inputs", "anim.gif"), Buffer.from("GIF89a", "utf-8"))
    await fs.writeFile(path.join(versionDir(), "00_inputs", "asset.webp"), Buffer.from("RIFFxxxxWEBP", "utf-8"))
    const longText = "x".repeat(16)
    await fs.writeFile(path.join(versionDir(), "00_inputs", "long.txt"), longText, "utf-8")
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      for (const [fileName, mimeType] of [
        ["photo.jpg", "image/jpeg"],
        ["photo-large.jpeg", "image/jpeg"],
        ["anim.gif", "image/gif"],
        ["asset.webp", "image/webp"],
      ] as const) {
        const image = await server.inject({
          method: "GET",
          url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent(`00_inputs/${fileName}`)}`,
        })
        assert.equal(image.statusCode, 200)
        assert.equal(image.json().type, "image")
        assert.equal(image.json().mimeType, mimeType)
      }

      const chunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/long.txt")}&length=999999999`,
      })
      assert.equal(chunk.statusCode, 200)
      assert.equal(Buffer.from(chunk.json().contentBase64, "base64").toString("utf-8"), longText)
      assert.equal(chunk.json().complete, true)
    } finally {
      await server.close()
    }
  })

  it("validates root file paths, directory-as-file requests, default chunk lengths, and archive name cleanup", async () => {
    await fs.writeFile(path.join(versionDir(), "00_inputs", "chunk-default.txt"), "abcdef", "utf-8")
    const server = await createTestServer({
      config: createTestConfig({
        workspace: {
          textChunkBytes: 2,
          textChunkMaxBytes: 4,
        },
      }),
    })
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      for (const route of ["content", "text", "text-chunk"] as const) {
        const response = await server.inject({
          method: "GET",
          url: `/api/workspace/files/${route}?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("/")}`,
        })
        assert.equal(response.statusCode, 400)
        assert.deepEqual(response.json(), { error: "relativePath is required" })
      }

      const directoryContent = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs")}`,
      })
      assert.equal(directoryContent.statusCode, 404)
      assert.deepEqual(directoryContent.json(), { error: "file not found" })

      const defaultLengthChunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/chunk-default.txt")}&length=not-a-number`,
      })
      assert.equal(defaultLengthChunk.statusCode, 200)
      assert.equal(Buffer.from(defaultLengthChunk.json().contentBase64, "base64").toString("utf-8"), "ab")
      assert.equal(defaultLengthChunk.json().nextOffset, 2)
      assert.equal(defaultLengthChunk.json().complete, false)

      const archive = await server.inject({
        method: "GET",
        url: `/api/workspace/files/archive?workspaceDir=${workspaceDir}&workspaceId=${encodeURIComponent("bad workspace/id")}`,
      })
      assert.equal(archive.statusCode, 200)
      assert.match(archive.headers["content-disposition"] as string, /attachment; filename="bad_workspace_id\.zip"/u)

      const fallbackArchiveName = await server.inject({
        method: "GET",
        url: `/api/workspace/files/archive?workspaceDir=${workspaceDir}&workspaceId=${encodeURIComponent("!!!")}`,
      })
      assert.equal(fallbackArchiveName.statusCode, 200)
      assert.match(fallbackArchiveName.headers["content-disposition"] as string, /attachment; filename="workspace\.zip"/u)
    } finally {
      await server.close()
    }
  })

  it("treats dot and slash file tree paths as the workspace root", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      for (const relativePath of [".", "/"]) {
        const response = await server.inject({
          method: "GET",
          url: `/api/workspace/files/tree?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent(relativePath)}`,
        })
        const body = response.json()

        assert.equal(response.statusCode, 200)
        assert.equal(body.relativePath, "")
        assert.equal(body.workspaceDir, versionDir())
        assert.ok(body.entries.some((entry: { name?: string }) => entry.name === "00_inputs"))
      }
    } finally {
      await server.close()
    }
  })

  it("normalizes file paths and reports text preview boundaries", async () => {
    await fs.writeFile(path.join(versionDir(), "00_inputs", "config.json"), "{}", "utf-8")
    await fs.writeFile(path.join(versionDir(), "00_inputs", "report.md"), "# Report", "utf-8")
    await fs.writeFile(path.join(versionDir(), "00_inputs", "script.42"), "LINE42", "utf-8")
    await fs.writeFile(path.join(versionDir(), "00_inputs", "large.txt"), "x".repeat(12), "utf-8")
    const server = await createTestServer({
      config: createTestConfig({
        workspace: {
          filePreviewMaxBytes: 8,
          textChunkBytes: 3,
          textChunkMaxBytes: 4,
          textFileMaxBytes: 64,
        },
      }),
    })
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const jsonContent = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("/00_inputs\\config.json/")}`,
      })
      assert.equal(jsonContent.statusCode, 200)
      assert.equal(jsonContent.json().type, "text")
      assert.equal(jsonContent.json().mimeType, "application/json")
      assert.equal(jsonContent.json().relativePath, "00_inputs/config.json")

      const markdownText = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/report.md")}`,
      })
      assert.equal(markdownText.statusCode, 200)
      assert.equal(markdownText.json().mimeType, "text/markdown")

      const largePreview = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/large.txt")}`,
      })
      assert.equal(largePreview.statusCode, 200)
      assert.equal(largePreview.json().type, "binary")
      assert.equal(largePreview.json().reason, "file too large for preview")

      const defaultChunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/script.42")}&offset=-5`,
      })
      assert.equal(defaultChunk.statusCode, 200)
      assert.equal(defaultChunk.json().offset, 0)
      assert.equal(Buffer.from(defaultChunk.json().contentBase64, "base64").toString("utf-8"), "LIN")
      assert.equal(defaultChunk.json().mimeType, "text/plain")

      const defaultMaxBytesText = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/large.txt")}&maxBytes=0`,
      })
      assert.equal(defaultMaxBytesText.statusCode, 200)
      assert.equal(defaultMaxBytesText.json().content, "x".repeat(12))

      const jsonChunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/config.json")}&length=2`,
      })
      assert.equal(jsonChunk.statusCode, 200)
      assert.equal(jsonChunk.json().mimeType, "application/json")
      assert.equal(Buffer.from(jsonChunk.json().contentBase64, "base64").toString("utf-8"), "{}")
    } finally {
      await server.close()
    }
  })

  it("enforces text file limits and archives workspaces", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const tooLarge = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/notes.txt")}&maxBytes=4`,
      })
      assert.equal(tooLarge.statusCode, 413)
      assert.match(tooLarge.json().error, /file too large/u)

      const unsupported = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/binary.bin")}`,
      })
      assert.equal(unsupported.statusCode, 400)
      assert.deepEqual(unsupported.json(), { error: "unsupported text file type" })

      const archive = await server.inject({
        method: "GET",
        url: `/api/workspace/files/archive?workspaceDir=${workspaceDir}`,
      })
      assert.equal(archive.statusCode, 200)
      assert.equal(archive.headers["content-type"], "application/zip")
      assert.match(archive.headers["content-disposition"] as string, /attachment; filename="v0001\.zip"/u)
      assert.equal(archive.rawPayload.subarray(0, 2).toString("utf-8"), "PK")
    } finally {
      await server.close()
    }
  })

  it("reads component info, BOM, and progress payloads", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const componentResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/component-info?workspaceDir=${workspaceDir}`,
      })
      assert.equal(componentResponse.statusCode, 200)
      assert.equal(componentResponse.json().components[0].id, "P001")
      assert.match(componentResponse.json().source_path, /geom_component_info\.json$/u)

      const bomResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/bom?workspaceDir=${workspaceDir}`,
      })
      assert.equal(bomResponse.statusCode, 200)
      assert.equal(bomResponse.json().bom_id, "bom-1")
      assert.equal(bomResponse.json().total_records, 1)

      const progressResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/progress?workspaceDir=${workspaceDir}`,
      })
      assert.equal(progressResponse.statusCode, 200)
      assert.equal(progressResponse.json().exists, true)
      assert.equal(progressResponse.json().data.status, "completed")
    } finally {
      await server.close()
    }
  })

  it("enriches real BOM items from the thermal database", async () => {
    await fs.rm(path.join(versionDir(), "00_inputs", "bom_component_info.json"))
    await writeJson(path.join(versionDir(), "00_inputs", "real_bom.json"), {
      items: [
        {
          component_id: "U_STAR",
          display_info: { local_note: "keep me" },
          source_ref: { template_csv_model: "KSST-01" },
        },
      ],
      schema_version: "real-bom/1.0",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/bom?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()
      const item = body.items[0]

      assert.equal(response.statusCode, 200)
      assert.equal(body.schema_version, "real-bom/1.0")
      assert.equal(body.total_records, 1)
      assert.equal(body.matched_records, 1)
      assert.equal(body.missing_records, 0)
      assert.equal(body.bom_lookup.matched_records, 1)
      assert.equal(body.bom_lookup.unmatched_keys.length, 0)
      assert.match(body.bom_lookup.database_path, /热仿真数据库\.json$/u)
      assert.equal(item.mass_kg, 0.197)
      assert.equal(item.power_W, 0.7)
      assert.deepEqual(item.size_mm, [56, 60, 93])
      assert.equal(item.thermal_db_component_id, "ADCS-001")
      assert.equal(item.display_info.local_note, "keep me")
      assert.equal(item.display_info.model, "KSST-01")
      assert.equal(item.display_info.name, "Kairospace Star Tracker")
      assert.equal(item.display_info.workbook_sheet, "Sheet1")
      assert.equal(item.excel_and_cad.excel_model, "KSST-01")
      assert.equal(item.excel_and_cad.thermal_db_component_id, "ADCS-001")
      assert.equal(item.excel_and_cad.image_path_exists, true)
      assert.match(body.source_path, /real_bom\.json$/u)
    } finally {
      await server.close()
    }
  })

  it("returns empty or invalid-state payloads for missing component, BOM, and progress files", async () => {
    await fs.rm(path.join(versionDir(), "component_info", "geom_component_info.json"))
    await fs.rm(path.join(versionDir(), "00_inputs", "bom_component_info.json"))
    await fs.rm(path.join(versionDir(), "logs", "progress.json"))
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const componentResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/component-info?workspaceDir=${workspaceDir}`,
      })
      assert.equal(componentResponse.statusCode, 404)
      assert.deepEqual(componentResponse.json(), { error: "component info data not found" })

      const bomResponse = await server.inject({
        method: "GET",
        url: `/api/workspace/bom?workspaceDir=${workspaceDir}`,
      })
      assert.equal(bomResponse.statusCode, 200)
      assert.deepEqual(bomResponse.json(), {
        bom_id: "-",
        components: [],
        matched_records: 0,
        missing_records: 0,
        schema_version: "-",
        source_path: "",
        source_version: "",
        total_records: 0,
      })

      const missingProgress = await server.inject({
        method: "GET",
        url: `/api/workspace/progress?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingProgress.statusCode, 200)
      assert.equal(missingProgress.json().exists, false)
      assert.equal(missingProgress.json().data, null)

      await writeJson(path.join(versionDir(), "AIGNC_Workflow", "loop_progress.json"), ["not", "object"])
      await fs.writeFile(path.join(versionDir(), "AIGNC_Workflow", "loop_progress.json"), "{bad-json", "utf-8")
      const invalidProgress = await server.inject({
        method: "GET",
        url: `/api/workspace/progress?workspaceDir=${workspaceDir}`,
      })
      assert.equal(invalidProgress.statusCode, 200)
      assert.equal(invalidProgress.json().exists, false)
      assert.equal(invalidProgress.json().error, "progress json is not valid yet")
      assert.match(invalidProgress.json().source_path, /AIGNC_Workflow\/loop_progress\.json$/u)
    } finally {
      await server.close()
    }
  })

  it("falls back to real_bom.json when normalized BOM output is absent", async () => {
    await fs.rm(path.join(versionDir(), "00_inputs", "bom_component_info.json"))
    await writeJson(path.join(versionDir(), "00_inputs", "real_bom.json"), {
      items: [
        {
          name: "fallback resistor",
          quantity: 2,
          source_ref: { template_csv_model: "MODEL_NOT_IN_DB" },
        },
      ],
      schema_version: "real-bom/1.0",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/bom?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.schema_version, "real-bom/1.0")
      assert.equal(body.items[0].name, "fallback resistor")
      assert.equal(body.items[0].quantity, 2)
      assert.equal(body.total_records, 1)
      assert.equal(body.missing_records, 1)
      assert.equal(body.bom_lookup.unmatched_keys[0], "MODEL_NOT_IN_DB")
      assert.match(body.source_path, /real_bom\.json$/u)
    } finally {
      await server.close()
    }
  })

  it("enriches real BOM items that use direct template model fields", async () => {
    await fs.rm(path.join(versionDir(), "00_inputs", "bom_component_info.json"))
    await writeJson(path.join(versionDir(), "00_inputs", "real_bom.json"), {
      items: [
        {
          component_id: "DIRECT",
          display_info: "ignored",
          excel_and_cad: "ignored",
          template_csv_model: "KSST-01",
        },
        "ignored non-object item",
        {
          component_id: "NO_LOOKUP",
        },
      ],
      schema_version: "real-bom/1.0",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/bom?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()
      const direct = body.items[0]

      assert.equal(response.statusCode, 200)
      assert.equal(body.items[1], "ignored non-object item")
      assert.equal(body.items[2].component_id, "NO_LOOKUP")
      assert.equal(body.total_records, 3)
      assert.equal(body.matched_records, 1)
      assert.equal(direct.thermal_db_component_id, "ADCS-001")
      assert.equal(direct.display_info.model, "KSST-01")
      assert.equal(direct.excel_and_cad.excel_model, "KSST-01")
    } finally {
      await server.close()
    }
  })

  it("prefers AIGNC loop progress over the default workspace progress file", async () => {
    await writeJson(path.join(versionDir(), "AIGNC_Workflow", "loop_progress.json"), {
      loop: 3,
      stage: "aignc-loop",
      status: "running",
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/progress?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.exists, true)
      assert.equal(body.data.stage, "aignc-loop")
      assert.equal(body.data.loop, 3)
      assert.match(body.source_path, /AIGNC_Workflow\/loop_progress\.json$/u)
    } finally {
      await server.close()
    }
  })

  it("falls back to registry session progress when workspace progress is absent", async () => {
    await fs.rm(path.join(versionDir(), "logs", "progress.json"))
    const glbPath = path.join(versionDir(), "assembly_builds", "Doc_Two", "outputs", "geometry_after.glb")
    await fs.mkdir(path.dirname(glbPath), { recursive: true })
    await fs.writeFile(glbPath, Buffer.from("glb"))
    await fs.mkdir(path.join(versionDir(), "logs", "registry", "runs"), { recursive: true })
    await writeJson(path.join(versionDir(), "logs", "registry", "index.json"), {
      runs: {
        run_progress_1: "runs/run_progress_1.json",
      },
      sessions: {
        session_progress_1: ["runs/run_progress_1.json"],
      },
      version: 1,
    })
    await writeJson(path.join(versionDir(), "logs", "registry", "runs", "run_progress_1.json"), {
      created_at: "2026-01-01T00:00:00.000Z",
      inputs: {
        doc_name: "Doc Two",
      },
      operation: {
        status: "success",
        tool: "cad-create-assembly",
      },
      outputs: {
        glb_path: path.relative(versionDir(), glbPath),
      },
      result: {
        progress_percentages: {
          export_file_percent: 75,
          layout_completion_percent: 90,
          modeling_percent: 80,
        },
        success: true,
      },
      run_id: "run_progress_1",
      session_id: "session_progress_1",
      thread_id: "thread-progress",
      turn_id: "turn-progress",
      updated_at: "2026-01-01T00:02:00.000Z",
      version: 1,
    })
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/progress?workspaceDir=${encodeURIComponent(versionDir())}&sessionId=session_progress_1`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.exists, true)
      assert.equal(body.data.run_id, "run_progress_1")
      assert.equal(body.data.session_id, "session_progress_1")
      assert.equal(body.data.progress_percentages.export_file_percent, 75)
      assert.equal(body.data.output_files.glb.path, "assembly_builds/Doc_Two/outputs/geometry_after.glb")
      assert.match(body.source_path, /run_progress_1\.json$/u)
    } finally {
      await server.close()
    }
  })

  it("reads COMSOL temperature field data", async () => {
    await fs.mkdir(path.join(versionDir(), "02_sim", "simulation"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "02_sim", "simulation", "data1.txt"), [
      "% x y z T",
      "0 0 0 280",
      "1 2 3 300",
      "bad row",
    ].join("\n"), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/temperature-field?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(response.headers["content-type"], "application/json; charset=utf-8")
      assert.equal(body.point_count, 2)
      assert.deepEqual(body.bounds.min, [0, 0, 0])
      assert.deepEqual(body.bounds.max, [1, 2, 3])
      assert.deepEqual(body.temperature_range_K, { min: 280, max: 300 })
      assert.deepEqual(body.attributes.temperature_K, [280, 300])
    } finally {
      await server.close()
    }
  })

  it("prefers postprocessed Three.js temperature point clouds", async () => {
    await writeJson(path.join(versionDir(), "02_sim", "postprocess", "temperature_field_threejs.json"), {
      schema_version: "1.0",
      format: "threejs_temperature_point_cloud",
      source: { temperature_array: "T" },
      point_count: 3,
      bounds: { min: [0, 0, 0], max: [2, 0, 0] },
      temperature_range_K: { min: 280, max: 320 },
      attributes: {
        position: [0, 0, 0, 1, 0, 0, 2, 0, 0],
        temperature_K: [280, 300, 320],
        color_rgb: [0, 0, 1, 0, 1, 0, 1, 0, 0],
      },
    })
    await fs.mkdir(path.join(versionDir(), "02_sim", "simulation"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "02_sim", "simulation", "data1.txt"), "0 0 0 280\n", "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/temperature-field?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.equal(body.point_count, 3)
      assert.deepEqual(body.attributes.position, [0, 0, 0, 1, 0, 0, 2, 0, 0])
      assert.deepEqual(body.attributes.temperature_K, [280, 300, 320])
    } finally {
      await server.close()
    }
  })

  it("handles uniform COMSOL temperature fields", async () => {
    await fs.mkdir(path.join(versionDir(), "02_sim", "simulation"), { recursive: true })
    await fs.writeFile(path.join(versionDir(), "02_sim", "simulation", "data1.txt"), [
      "0,0,0,300",
      "1,1,1,300",
    ].join("\n"), "utf-8")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/temperature-field?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      const body = response.json()

      assert.equal(response.statusCode, 200)
      assert.deepEqual(body.temperature_range_K, { min: 300, max: 300 })
      assert.deepEqual(body.attributes.color_rgb, [0, 0, 1, 0, 0, 1])
    } finally {
      await server.close()
    }
  })

  it("returns 404 for missing or invalid temperature field data", async () => {
    const server = await createTestServer()

    try {
      const missing = await server.inject({
        method: "GET",
        url: `/api/workspace/temperature-field?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(missing.statusCode, 404)
      assert.deepEqual(missing.json(), { error: "temperature field not found" })

      await fs.mkdir(path.join(versionDir(), "02_sim", "simulation"), { recursive: true })
      await fs.writeFile(path.join(versionDir(), "02_sim", "simulation", "data1.txt"), "not finite data", "utf-8")
      const invalid = await server.inject({
        method: "GET",
        url: `/api/workspace/temperature-field?workspaceDir=${encodeURIComponent(versionDir())}`,
      })
      assert.equal(invalid.statusCode, 404)
      assert.deepEqual(invalid.json(), { error: "temperature field not found" })
    } finally {
      await server.close()
    }
  })

  it("persists derating missing items and check results", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const missingPut = await server.inject({
        method: "PUT",
        payload: { components: [{ component_id: "R1" }] },
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingPut.statusCode, 200)

      const missingGet = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingGet.statusCode, 200)
      assert.equal(missingGet.json().components[0].component_id, "R1")

      const checkPut = await server.inject({
        method: "PUT",
        payload: {
          rows: [
            {
              component_id: "R1",
              "符合性": "通过",
              "问题": ["过压", "过压", ""],
            },
            ["ignored"],
            {
              component_id: "R2",
              "综合判定": "不通过",
            },
            {
              component_id: "R3",
            },
          ],
        },
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(checkPut.statusCode, 200)
      assert.deepEqual(checkPut.json().summary, {
        total_rows: 3,
        "不通过": 1,
        "未判定": 1,
        "通过": 1,
      })
      assert.deepEqual(checkPut.json().issue_counts, { "过压": 2 })

      const checkGet = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(checkGet.statusCode, 200)
      assert.deepEqual(checkGet.json().rows.map((row: { component_id?: string }) => row.component_id), ["R1", "R2", "R3"])
    } finally {
      await server.close()
    }
  })

  it("reads derating compliance output files and validates derating request bodies", async () => {
    const outputDir = path.join(versionDir(), "check_outputs", "compliance", "derating")
    await fs.mkdir(outputDir, { recursive: true })
    await writeJson(path.join(outputDir, "table.json"), {
      data: [
        {
          "元器件名称": "R1",
          "型号规格_规格": "0603",
          "生产厂商_生产单位": "ACME",
          "降额参数": "电压",
        },
      ],
    })
    await writeJson(path.join(outputDir, "mapping_completeness.json"), {
      components: [
        {
          "元器件名称": "R1",
          "元器件大类": "电阻器",
          "元器件子类": "固定电阻器",
          missing_count: 2,
        },
      ],
      schema_version: "fallback",
    })
    await writeJson(path.join(outputDir, "check_result.json"), {
      rows: [
        {
          "元器件名称": "R1",
          "符合性": "不通过",
          "问题": ["电压超限", "电压超限"],
        },
      ],
      schema_version: "fallback",
    })
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const missingGet = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingGet.statusCode, 200)
      assert.equal(missingGet.json().source_relative_path, "check_outputs/compliance/derating/mapping_completeness.json")
      assert.equal(missingGet.json().components[0]["型号规格"], "0603")
      assert.equal(missingGet.json().components[0]["生产厂商"], "ACME")

      const checkGet = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(checkGet.statusCode, 200)
      assert.equal(checkGet.json().source_relative_path, "check_outputs/compliance/derating/check_result.json")
      assert.equal(checkGet.json().rows[0]["符合性"], "不通过")

      const invalidMissingPut = await server.inject({
        method: "PUT",
        payload: { components: "nope" },
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(invalidMissingPut.statusCode, 400)
      assert.deepEqual(invalidMissingPut.json(), { error: "components array is required" })

      const invalidCheckPut = await server.inject({
        method: "PUT",
        payload: { rows: "nope" },
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(invalidCheckPut.statusCode, 400)
      assert.deepEqual(invalidCheckPut.json(), { error: "rows array is required" })
    } finally {
      await server.close()
    }
  })

  it("returns derating parse errors for malformed output payloads", async () => {
    const outputDir = path.join(versionDir(), "check_outputs", "compliance", "derating")
    await fs.mkdir(outputDir, { recursive: true })
    await writeJson(path.join(outputDir, "bad_mapping_completeness.json"), ["not-object"])
    await writeJson(path.join(outputDir, "bad_check_result.json"), ["not-object"])
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const missingItems = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingItems.statusCode, 422)
      assert.deepEqual(missingItems.json(), { error: "derating completeness JSON root must be an object" })

      const checkResult = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(checkResult.statusCode, 422)
      assert.deepEqual(checkResult.json(), { error: "derating check result JSON root must be an object" })
    } finally {
      await server.close()
    }
  })

  it("rejects path traversal file requests", async () => {
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/files/content?workspaceDir=${encodeURIComponent(versionDir())}&relativePath=${encodeURIComponent("../outside.txt")}`,
      })

      assert.equal(response.statusCode, 400)
      assert.match(response.json().error, /relativePath/u)
    } finally {
      await server.close()
    }
  })

  it("rejects traversal and unsupported text chunk workspace file requests", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const treeTraversal = await server.inject({
        method: "GET",
        url: `/api/workspace/files/tree?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("../outside")}`,
      })
      assert.equal(treeTraversal.statusCode, 400)
      assert.deepEqual(treeTraversal.json(), { error: "relativePath must stay inside workspaceDir" })

      const textTraversal = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("../outside.txt")}`,
      })
      assert.equal(textTraversal.statusCode, 400)
      assert.deepEqual(textTraversal.json(), { error: "relativePath must stay inside workspaceDir" })

      const missingText = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/missing.txt")}`,
      })
      assert.equal(missingText.statusCode, 404)
      assert.deepEqual(missingText.json(), { error: "file not found" })

      const unsupportedChunk = await server.inject({
        method: "GET",
        url: `/api/workspace/files/text-chunk?workspaceDir=${workspaceDir}&relativePath=${encodeURIComponent("00_inputs/binary.bin")}`,
      })
      assert.equal(unsupportedChunk.statusCode, 400)
      assert.deepEqual(unsupportedChunk.json(), { error: "unsupported text file type" })
    } finally {
      await server.close()
    }
  })

  it("returns derating 404 payloads when compliance output files are absent", async () => {
    const server = await createTestServer()
    const workspaceDir = encodeURIComponent(versionDir())

    try {
      const missingItems = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/missing-items?workspaceDir=${workspaceDir}`,
      })
      assert.equal(missingItems.statusCode, 404)
      assert.deepEqual(missingItems.json(), { error: "derating mapping completeness JSON not found" })

      const checkResult = await server.inject({
        method: "GET",
        url: `/api/workspace/derating/check-result?workspaceDir=${workspaceDir}`,
      })
      assert.equal(checkResult.statusCode, 404)
      assert.deepEqual(checkResult.json(), { error: "derating check result JSON not found" })
    } finally {
      await server.close()
    }
  })

  it("returns 404 when archiving a workspace directory that is allowed but missing", async () => {
    const missingWorkspaceDir = path.join(path.dirname(versionDir()), "missing-version")
    const server = await createTestServer()

    try {
      const response = await server.inject({
        method: "GET",
        url: `/api/workspace/files/archive?workspaceDir=${encodeURIComponent(missingWorkspaceDir)}`,
      })

      assert.equal(response.statusCode, 404)
      assert.deepEqual(response.json(), { error: "workspace directory not found" })
    } finally {
      await server.close()
    }
  })
})

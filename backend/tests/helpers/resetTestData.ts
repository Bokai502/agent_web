import fs from "node:fs/promises"
import path from "node:path"

export const TEST_DATA_ROOT = process.env.CODEX_WEB_TEST_ROOT
  ? path.resolve(process.env.CODEX_WEB_TEST_ROOT)
  : path.resolve(process.cwd(), "..", "..", "tmp", `open-codex-web-tests-${process.pid}`)

export async function resetTestData() {
  await fs.rm(TEST_DATA_ROOT, { force: true, recursive: true })
}

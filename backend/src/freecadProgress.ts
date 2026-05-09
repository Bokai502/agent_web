import fs from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import { resolveFreecadWorkspaceDir } from "./freecadWorkspace.js"

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

export async function getFreecadProgressPercentagesFile() {
  return path.join(await resolveFreecadWorkspaceDir(), "logs", "progress_percentages.json")
}

export async function initializeFreecadProgressForSession(sessionId: string, force = false) {
  const progressFile = await getFreecadProgressPercentagesFile()

  if (!force) {
    const raw = await fs.readFile(progressFile, "utf-8").catch(() => null)
    if (raw !== null) {
      try {
        const existing = JSON.parse(raw)
        if (existing?.session_id === sessionId) return
      } catch {
        // Replace malformed progress files with a clean session record.
      }
    }
  }

  await atomicWrite(progressFile, JSON.stringify({
    session_id: sessionId,
    thread_id: null,
    turn_id: null,
    tool: null,
    updated_at: null,
    success: null,
    progress_percentages: {},
    output_files: {},
    layout_completion_percent: 0,
    modeling_percent: 0,
    export_file_percent: 0,
  }, null, 2))
}

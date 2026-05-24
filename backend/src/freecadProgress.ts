import fs from "fs/promises"
import path from "path"
import { resolveFreecadWorkspaceDir } from "./freecadWorkspace.js"

export async function getFreecadProgressPercentagesFile() {
  return path.join(await resolveFreecadWorkspaceDir(), "logs", "progress.json")
}

export async function initializeFreecadProgressForSession(_sessionId: string, _force = false) {
  const progressFile = await getFreecadProgressPercentagesFile()
  await fs.mkdir(path.dirname(progressFile), { recursive: true })
}

import fs from "fs/promises"
import path from "path"
import { resolveWorkspaceDir } from "./workspaceManager.js"

export async function getProgressPercentagesFile() {
  return path.join(await resolveWorkspaceDir(), "logs", "progress.json")
}

export async function initializeWorkspaceProgressForSession(_sessionId: string, _force = false) {
  const progressFile = await getProgressPercentagesFile()
  await fs.mkdir(path.dirname(progressFile), { recursive: true })
}

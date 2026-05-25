import path from "path"
import { isNonEmptyString } from "./workspaceQuery.js"

export function resolveScopedWorkspaceFilePath(filePath: string | null | undefined, workspaceDir: string) {
  if (!isNonEmptyString(filePath)) return null

  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspaceDir, filePath)
  const relativeToWorkspace = path.relative(workspaceDir, resolvedPath)
  if (
    relativeToWorkspace === "" ||
    (!relativeToWorkspace.startsWith("..") && !path.isAbsolute(relativeToWorkspace))
  ) {
    return resolvedPath
  }

  return null
}

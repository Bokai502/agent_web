import path from "node:path"
import type { AppConfig } from "../config.js"

export type WorkspacePathConfig = Pick<AppConfig, "auth" | "workspace">

export function resolveWorkspaceTemplateRoot(config: Pick<AppConfig, "workspace">) {
  return path.resolve(config.workspace.templateDir ?? path.resolve(process.cwd(), "..", "data", "input_data"))
}

export function resolveUsersRootFromConfig(config: WorkspacePathConfig) {
  const templateRoot = resolveWorkspaceTemplateRoot(config)
  const configuredUsersRoot = config.workspace.usersRoot ?? config.auth.usersDir
  return path.isAbsolute(configuredUsersRoot)
    ? path.resolve(configuredUsersRoot)
    : path.resolve(templateRoot, configuredUsersRoot)
}

export function resolveUserWorkspaceRoot(config: WorkspacePathConfig, userId: string) {
  return path.join(resolveUsersRootFromConfig(config), userId)
}

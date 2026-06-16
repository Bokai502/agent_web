import { readWorkspaceSessionHistory } from "../sessions/sessionStore.js"
import type { SkillInstruction } from "../system/skills.js"
import { ASK_USER_PROTOCOL } from "./askUserProtocol.js"
import type { RunContext, RunInputItem } from "./runTypes.js"

type BuildSdkInputOptions = {
  compactSkillInstructions?: boolean
}

function stripFrontmatter(content: string) {
  const lines = content.split(/\r?\n/u)
  if (lines[0]?.trim() !== "---") return content
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  return endIndex >= 0 ? lines.slice(endIndex + 1).join("\n") : content
}

function buildCompactSkillInstructionsBlock(skillInstructions: SkillInstruction[]) {
  if (skillInstructions.length === 0) return ""

  return [
    "Enabled skill instructions:",
    "The user explicitly enabled these skills for this turn. Internal-model compact mode is active, so full skill files are not embedded in this first request.",
    "Before executing commands or editing files for a skill, read its Source file with the available file tools and follow the detailed instructions there.",
    ...skillInstructions.map(skill => [
      `## ${skill.name}`,
      `Description: ${skill.description || "(none)"}`,
      `Source: ${skill.file}`,
      "Use this skill when it matches the current step. Read the source before applying any detailed workflow, command, validation, or reporting rule.",
    ].join("\n")),
  ].join("\n\n")
}

function buildSkillInstructionsBlock(skillInstructions: SkillInstruction[], options: BuildSdkInputOptions = {}) {
  if (skillInstructions.length === 0) return ""
  if (options.compactSkillInstructions) return buildCompactSkillInstructionsBlock(skillInstructions)

  return [
    "Enabled skill instructions:",
    "The user explicitly enabled these skills for this turn. Follow the matching skill instructions when they apply.",
    ...skillInstructions.map(skill => [
      `## ${skill.name}`,
      `Description: ${skill.description || "(none)"}`,
      `Source: ${skill.file}`,
      "",
      stripFrontmatter(skill.content).trim(),
    ].join("\n")),
  ].join("\n\n")
}

function buildPromptPrefix(
  context: RunContext,
  skillInstructions: SkillInstruction[],
  options: BuildSdkInputOptions = {},
) {
  const executionContext = [
    "Execution context:",
    `- session_id: ${context.sessionId}`,
    `- thread_id: ${context.threadId ?? "null"}`,
    `- turn_id: ${context.turnId}`,
    `- workspace_id: ${context.workspaceId ?? "null"}`,
    `- version_id: ${context.versionId ?? "null"}`,
    `- workspace_dir: ${context.workspaceDir ?? "null"}`,
    "",
    "Use this same workspace_dir path for cad-sim-pipeline, workspace commands, artifact inspection, and logs.",
    "For versioned work, workspace_dir is the active version workspace selected by the Versioning API.",
    "For GNC/AIGNC work, treat workspace_dir/00_inputs as the mutable input package: Config, FSW, Script, and Output live there. Write AI workflow artifacts under workspace_dir/AIGNC_Workflow, not inside the mutable input package.",
    "When creating a new workspace or version through APIs or artifacts, use group xieteam.",
    "The Versioning API checkout/branch operation changes the active version in the workspace manifest; it does not rewrite open_codex_web/config.json.",
    "If a CLI supports --workspace-dir, pass this workspace_dir explicitly; do not rely on config.json defaults for versioned work.",
    "Bundled FreeCAD and simulation CLIs are exposed through PYTHONPATH for this run; prefer `python -m freecad_cli_tools.cli.main` and `python -m sim_cli_tools.cli.main` over globally installed wrappers.",
    "When invoking CLI commands, pass these correlation values through environment variables:",
    `- WORKSPACE_SESSION_ID=${context.sessionId}`,
    `- WORKSPACE_THREAD_ID=${context.threadId ?? ""}`,
    `- WORKSPACE_TURN_ID=${context.turnId}`,
    "- WORKSPACE_CALLER=open_codex_web",
    "- WORKSPACE_AGENT_NAME=codex",
    context.workspaceDir
      ? "Before running workspace-scoped commands, verify they target the workspace_dir above."
      : "No workspace is currently configured; ask before running workspace-scoped CLI commands.",
  ].join("\n")
  const skillsBlock = buildSkillInstructionsBlock(skillInstructions, options).trim()
  return [
    executionContext,
    skillsBlock || null,
  ].filter((block): block is string => block !== null).join("\n\n")
}

export async function shouldInjectPromptPrefixForSession(sessionId: string, workspaceDir: string | null) {
  const sessions = await readWorkspaceSessionHistory(workspaceDir)
  const existing = sessions.find(session => session.id === sessionId)
  if (!existing) return true
  return !Array.isArray(existing.turns) || existing.turns.length === 0
}

export function buildSdkInput(
  input: RunInputItem[],
  context: RunContext,
  injectPromptPrefix: boolean,
  skillInstructions: SkillInstruction[],
  options: BuildSdkInputOptions = {},
): string | RunInputItem[] {
  if (!injectPromptPrefix) return input

  const prefix = buildPromptPrefix(context, skillInstructions, options)
  const firstTextIndex = input.findIndex(item => item.type === "text")

  if (firstTextIndex === -1) {
    return [{ type: "text", text: prefix }, ...input]
  }

  return input.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") return item
    return { type: "text", text: `${prefix}\n\n${item.text.trim()}` }
  })
}

export { ASK_USER_PROTOCOL }

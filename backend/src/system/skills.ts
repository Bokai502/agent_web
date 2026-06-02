import fs from "fs"
import path from "path"
import os from "os"
import type { Logger } from "../logger.js"

export interface Skill {
  name: string
  description: string
}

export interface SkillInstruction {
  name: string
  description: string
  file: string
  content: string
}

export interface SkillsCache {
  public: Skill[]
  thermal: Skill[]
  aignc: Skill[]
  check: Skill[]
}

export type SkillScope = keyof SkillsCache

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".codex", "skills")
const GNC_SKILLS_DIR = path.resolve(process.cwd(), "workflow_agents", "gnc_skills")
const THERMAL_SKILLS_DIR = path.resolve(process.cwd(), "workflow_agents", "thermal_skills")
const CHECK_SKILLS_DIR = path.resolve(process.cwd(), "workflow_agents", "check_skills")
const ROUTING_SKILLS_DIR = path.resolve(process.cwd(), "workflow_agents", "routing_skills")
const CACHE_FILE = path.resolve(process.cwd(), "skills.json")

function dedupeExistingRoots(roots: string[]): string[] {
  const seen = new Set<string>()
  return roots
    .map(root => path.resolve(root))
    .filter(root => {
      const key = root.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return fs.existsSync(root)
    })
}

function getPublicSkillRoots(): string[] {
  const extraRoots = (process.env.CODEX_WEB_SKILLS_DIRS ?? "")
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean)

  return dedupeExistingRoots([GLOBAL_SKILLS_DIR, ...extraRoots])
}

function getAigncSkillRoots(): string[] {
  return dedupeExistingRoots([GNC_SKILLS_DIR])
}

function getThermalSkillRoots(): string[] {
  return dedupeExistingRoots([THERMAL_SKILLS_DIR])
}

function getCheckSkillRoots(): string[] {
  return dedupeExistingRoots([CHECK_SKILLS_DIR])
}

function getSkillRootsForScopes(scopes: SkillScope[]): string[] {
  const roots = scopes.flatMap(scope => {
    if (scope === "public") return getPublicSkillRoots()
    if (scope === "thermal") return getThermalSkillRoots()
    if (scope === "aignc") return getAigncSkillRoots()
    return getCheckSkillRoots()
  })
  return dedupeExistingRoots(roots)
}

// 解析 SKILL.md 顶部 YAML frontmatter，只取 name / description 两个字段。
// 格式: 首行是 `---`，之后 `key: value` 或 `key: "quoted value"`，遇到下一个 `---` 结束。
function parseFrontmatter(content: string): Partial<Skill> {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return {}

  const result: Partial<Skill> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "---") break

    const match = line.match(/^([\w-]+):\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    let value = match[2].trim()

    // 去掉包围的单/双引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key === "name") result.name = value
    else if (key === "description") result.description = value
  }
  return result
}

// 递归查找 SKILL.md：用户 skill 在 <dir>/SKILL.md，系统 skill 在 .system/<dir>/SKILL.md
// 层数限制避免意外软链接导致死循环
function findSkillFiles(root: string, depth: number, acc: { file: string; dirName: string }[]) {
  if (depth > 3) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sub = path.join(root, entry.name)
    const skillFile = path.join(sub, "SKILL.md")
    if (fs.existsSync(skillFile)) {
      acc.push({ file: skillFile, dirName: entry.name })
    } else {
      findSkillFiles(sub, depth + 1, acc)
    }
  }
}

function scanSkillsFromRoots(roots: string[]): Skill[] {
  const found: { file: string; dirName: string }[] = []
  for (const root of roots) {
    findSkillFiles(root, 0, found)
  }

  const skills: Skill[] = []
  for (const { file, dirName } of found) {
    try {
      const content = fs.readFileSync(file, "utf-8")
      const fm = parseFrontmatter(content)
      skills.push({
        name: fm.name || dirName,
        description: fm.description || "",
      })
    } catch {
      // 读取失败的 skill 跳过，不阻断整体扫描
    }
  }

  // 按 name 去重（避免同名 skill 在不同目录都被收录）
  const seen = new Set<string>()
  const deduped = skills.filter(s => {
    const key = s.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  deduped.sort((a, b) => a.name.localeCompare(b.name))
  return deduped
}

export function scanSkills(): SkillsCache {
  return {
    public: scanSkillsFromRoots(getPublicSkillRoots()),
    thermal: scanSkillsFromRoots(getThermalSkillRoots()),
    aignc: scanSkillsFromRoots(getAigncSkillRoots()),
    check: scanSkillsFromRoots(getCheckSkillRoots()),
  }
}

export function readSkillInstructions(skillNames: string[], scopes: SkillScope[] = ["public", "thermal", "aignc", "check"]): SkillInstruction[] {
  if (skillNames.length === 0) return []

  const requested = new Set(
    skillNames
      .map(name => name.trim().toLowerCase())
      .filter(Boolean)
  )
  if (requested.size === 0) return []

  const found: { file: string; dirName: string }[] = []
  const roots = getSkillRootsForScopes(scopes)
  for (const root of roots) {
    findSkillFiles(root, 0, found)
  }

  const instructions: SkillInstruction[] = []
  const seen = new Set<string>()

  for (const { file, dirName } of found) {
    try {
      const content = fs.readFileSync(file, "utf-8")
      const fm = parseFrontmatter(content)
      const name = fm.name || dirName
      const key = name.toLowerCase()

      if (!requested.has(key) || seen.has(key)) continue
      seen.add(key)

      instructions.push({
        name,
        description: fm.description || "",
        file,
        content,
      })
    } catch {
      // 读取失败的 skill 跳过，不阻断整体运行
    }
  }

  instructions.sort((a, b) => a.name.localeCompare(b.name))
  return instructions
}

function readSkillInstructionsFromRoots(roots: string[]): SkillInstruction[] {
  const found: { file: string; dirName: string }[] = []
  for (const root of roots) {
    findSkillFiles(root, 0, found)
  }

  const instructions: SkillInstruction[] = []
  const seen = new Set<string>()

  for (const { file, dirName } of found) {
    try {
      const content = fs.readFileSync(file, "utf-8")
      const fm = parseFrontmatter(content)
      const name = fm.name || dirName
      const key = name.toLowerCase()

      if (seen.has(key)) continue
      seen.add(key)

      instructions.push({
        name,
        description: fm.description || "",
        file,
        content,
      })
    } catch {
      // 读取失败的 skill 跳过，不阻断整体运行
    }
  }

  instructions.sort((a, b) => a.name.localeCompare(b.name))
  return instructions
}

export function readPublicSkillInstructions(): SkillInstruction[] {
  return readSkillInstructionsFromRoots(getPublicSkillRoots())
}

export function readThermalSkillInstructions(): SkillInstruction[] {
  return readSkillInstructionsFromRoots(getThermalSkillRoots())
}

export function readAigncSkillInstructions(): SkillInstruction[] {
  return readSkillInstructionsFromRoots(getAigncSkillRoots())
}

export function readCheckSkillInstructions(): SkillInstruction[] {
  return readSkillInstructionsFromRoots(getCheckSkillRoots())
}

export function getWorkspaceSkillScopes(isGncWorkspace: boolean): SkillScope[] {
  return isGncWorkspace ? ["public", "aignc"] : ["public", "thermal"]
}

export function getWorkspaceAvailableSkillScopes(isGncWorkspace: boolean): SkillScope[] {
  return [...getWorkspaceSkillScopes(isGncWorkspace), "check"]
}

function dedupeInstructionsPreferLater(instructions: SkillInstruction[]): SkillInstruction[] {
  const byName = new Map<string, SkillInstruction>()
  for (const skill of instructions) {
    byName.set(skill.name.toLowerCase(), skill)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function readScopedSkillInstructions(scopes: SkillScope[]): SkillInstruction[] {
  const instructions = scopes.flatMap(scope => {
    if (scope === "public") return readPublicSkillInstructions()
    if (scope === "thermal") return readThermalSkillInstructions()
    if (scope === "aignc") return readAigncSkillInstructions()
    return readCheckSkillInstructions()
  })
  return dedupeInstructionsPreferLater(instructions)
}

export function readRoutingSkillInstruction(name: string): SkillInstruction | null {
  return readSkillInstructionsFromRoots(dedupeExistingRoots([ROUTING_SKILLS_DIR]))
    .find(skill => skill.name.toLowerCase() === name.trim().toLowerCase()) ?? null
}

export function refreshSkillsCache(logger: Logger): SkillsCache {
  const skills = scanSkills()
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(skills, null, 2), "utf-8")
    logger.info("skills cache refreshed", {
      aigncCount: skills.aignc.length,
      checkCount: skills.check.length,
      file: CACHE_FILE,
      publicCount: skills.public.length,
      thermalCount: skills.thermal.length,
    })
  } catch (err) {
    logger.error("failed to write skills cache", { err, file: CACHE_FILE })
  }
  return skills
}

function dedupeSkillsPreferLater(skills: Skill[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const skill of skills) {
    byName.set(skill.name.toLowerCase(), skill)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function readSkillsCache(scopes: SkillScope[] = ["public", "thermal"]): Skill[] {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8")
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data as Skill[]
    const skills = scopes.flatMap(scope => Array.isArray(data?.[scope]) ? data[scope] as Skill[] : [])
    return dedupeSkillsPreferLater(skills)
  } catch {
    return []
  }
}

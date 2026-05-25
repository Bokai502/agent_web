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

const SKILLS_DIR = path.join(os.homedir(), ".codex", "skills")
const CACHE_FILE = path.resolve(process.cwd(), "skills.json")

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

export function scanSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return []

  const found: { file: string; dirName: string }[] = []
  findSkillFiles(SKILLS_DIR, 0, found)

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
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })

  deduped.sort((a, b) => a.name.localeCompare(b.name))
  return deduped
}

export function readSkillInstructions(skillNames: string[]): SkillInstruction[] {
  if (!fs.existsSync(SKILLS_DIR) || skillNames.length === 0) return []

  const requested = new Set(
    skillNames
      .map(name => name.trim().toLowerCase())
      .filter(Boolean)
  )
  if (requested.size === 0) return []

  const found: { file: string; dirName: string }[] = []
  findSkillFiles(SKILLS_DIR, 0, found)

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

export function refreshSkillsCache(logger: Logger): Skill[] {
  const skills = scanSkills()
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(skills, null, 2), "utf-8")
    logger.info("skills cache refreshed", { count: skills.length, file: CACHE_FILE })
  } catch (err) {
    logger.error("failed to write skills cache", { err, file: CACHE_FILE })
  }
  return skills
}

export function readSkillsCache(): Skill[] {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data as Skill[] : []
  } catch {
    return []
  }
}

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "node:test"
import {
  getWorkspaceAvailableSkillScopes,
  getWorkspaceSkillScopes,
  readAigncSkillInstructions,
  readCheckSkillInstructions,
  readManagedPrompt,
  readPublicSkillInstructions,
  readScopedSkillInstructions,
  readSkillInstructions,
  readThermalSkillInstructions,
  scanSkills,
} from "../../../src/system/skills.js"
import { TEST_DATA_ROOT, resetTestData } from "../../helpers/resetTestData.js"

async function writeSkill(root: string, dir: string, content: string) {
  const skillDir = path.join(root, dir)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8")
}

describe("system skills helpers", () => {
  beforeEach(async () => {
    await resetTestData()
    delete process.env.CODEX_WEB_SKILLS_DIRS
  })

  it("scans public skills from configured roots and deduplicates by name", async () => {
    const rootA = path.join(TEST_DATA_ROOT, "skills-a")
    const rootB = path.join(TEST_DATA_ROOT, "skills-b")
    await writeSkill(rootA, "alpha", [
      "---",
      "name: alpha",
      "description: Alpha skill",
      "---",
      "Alpha body",
    ].join("\n"))
    await writeSkill(rootB, "alpha-copy", [
      "---",
      "name: alpha",
      "description: Later alpha",
      "---",
      "Duplicate body",
    ].join("\n"))
    await writeSkill(rootB, "quoted", [
      "---",
      "name: \"quoted-skill\"",
      "description: 'Quoted description'",
      "---",
      "Quoted body",
    ].join("\n"))
    process.env.CODEX_WEB_SKILLS_DIRS = [rootA, rootA, rootB].join(path.delimiter)

    const scanned = scanSkills()
    const publicNames = scanned.public.map((skill: { name: string }) => skill.name)

    assert.equal(publicNames.filter((name: string) => name === "alpha").length, 1)
    assert.equal(publicNames.includes("quoted-skill"), true)
    assert.equal(scanned.public.find((skill: { name: string }) => skill.name === "quoted-skill")?.description, "Quoted description")
  })

  it("falls back to directory names and finds nested system skills", async () => {
    const root = path.join(TEST_DATA_ROOT, "nested-skills")
    await writeSkill(root, "plain-dir", [
      "# Plain Skill",
      "",
      "No frontmatter here.",
    ].join("\n"))
    await writeSkill(path.join(root, ".system"), "system-alpha", [
      "---",
      "description: Missing explicit name",
      "---",
      "System alpha body",
    ].join("\n"))
    await fs.mkdir(path.join(root, "too-deep", "a", "b", "c", "d", "ignored"), { recursive: true })
    await fs.writeFile(path.join(root, "too-deep", "a", "b", "c", "d", "ignored", "SKILL.md"), [
      "---",
      "name: too-deep",
      "---",
      "Ignored body",
    ].join("\n"), "utf-8")
    process.env.CODEX_WEB_SKILLS_DIRS = root

    const scanned = scanSkills().public

    assert.equal(scanned.some((skill: { name: string }) => skill.name === "plain-dir"), true)
    assert.equal(scanned.some((skill: { description: string; name: string }) =>
      skill.name === "system-alpha" && skill.description === "Missing explicit name"
    ), true)
    assert.equal(scanned.some((skill: { name: string }) => skill.name === "too-deep"), false)
  })

  it("reads requested skill instructions case-insensitively", async () => {
    const root = path.join(TEST_DATA_ROOT, "skills")
    const content = [
      "---",
      "name: alpha",
      "description: Alpha skill",
      "---",
      "Alpha instructions",
    ].join("\n")
    await writeSkill(root, "alpha", content)
    process.env.CODEX_WEB_SKILLS_DIRS = root

    const empty = readSkillInstructions([])
    const blank = readSkillInstructions([" ", "\t"], ["public"])
    const instructions = readSkillInstructions([" ALPHA "], ["public"])

    assert.deepEqual(empty, [])
    assert.deepEqual(blank, [])
    assert.equal(instructions.length, 1)
    assert.equal(instructions[0].name, "alpha")
    assert.equal(instructions[0].description, "Alpha skill")
    assert.equal(instructions[0].content, content)
  })

  it("deduplicates scoped instructions", async () => {
    const root = path.join(TEST_DATA_ROOT, "skills")
    await writeSkill(root, "zeta", [
      "---",
      "name: zeta",
      "description: Zeta",
      "---",
      "Zeta body",
    ].join("\n"))
    process.env.CODEX_WEB_SKILLS_DIRS = root

    const instructions = readScopedSkillInstructions(["public", "thermal"])
    assert.equal(instructions.some((item: { name: string }) => item.name === "zeta"), true)
  })

  it("reads built-in skill scopes and managed prompts", async () => {
    const publicInstructions = readPublicSkillInstructions()
    const thermalInstructions = readThermalSkillInstructions()
    const gncInstructions = readAigncSkillInstructions()
    const checkInstructions = readCheckSkillInstructions()
    const prompt = readManagedPrompt(" PIPELINE-PROGRESS-SUMMARIZER ")

    assert.equal(Array.isArray(publicInstructions), true)
    assert.equal(thermalInstructions.some((item: { name: string }) => item.name === "freecad"), true)
    assert.equal(gncInstructions.some((item: { name: string }) => item.name === "aignc-42-orchestrator"), true)
    assert.equal(checkInstructions.some((item: { name: string }) => item.name === "component-derating-classifier"), true)
    assert.equal(prompt?.name, "pipeline-progress-summarizer")
    assert.match(prompt?.content ?? "", /pipeline/iu)
  })

  it("returns workspace scopes and null for missing managed prompts", async () => {
    assert.deepEqual(getWorkspaceSkillScopes(false), ["public", "thermal"])
    assert.deepEqual(getWorkspaceSkillScopes(true), ["public", "aignc"])
    assert.deepEqual(getWorkspaceAvailableSkillScopes(false), ["public", "thermal", "check"])
    assert.equal(readManagedPrompt("definitely-missing-managed-prompt"), null)
  })

})

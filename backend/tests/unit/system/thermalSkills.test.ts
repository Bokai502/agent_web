import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const BACKEND_ROOT = process.cwd()
const THERMAL_SKILLS_DIR = path.join(BACKEND_ROOT, "workflow_agents", "thermal_skills")
const FREECAD_CLI_SRC_DIR = path.join(BACKEND_ROOT, "workflow_agents", "agents", "freecad_cli_tools", "src")
const SIM_CLI_SRC_DIR = path.join(BACKEND_ROOT, "workflow_agents", "agents", "sim_cli_tools", "src")
const SIM_RUNTIME_DIR = path.join(BACKEND_ROOT, "workflow_agents", "agents", "sim_cli_tools", "runtime")

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(root, entry.name)
    if (entry.isDirectory()) return listFiles(filePath)
    if (entry.isFile()) return [filePath]
    return []
  }))
  return files.flat()
}

function pythonPath(...entries: string[]) {
  return entries.join(path.delimiter)
}

async function execFileForStdout(command: string, args: string[], options: { env: NodeJS.ProcessEnv }) {
  try {
    return (await execFileAsync(command, args, options)).stdout
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout
    if (typeof stdout === "string" && stdout.trim()) return stdout
    throw error
  }
}

describe("thermal workflow skills", () => {
  it("ships the expected skill files and non-empty support assets", async () => {
    const requiredFiles = [
      "cad-sim-report-agent/SKILL.md",
      "cad-sim-report-agent/agents/openai.yaml",
      "cad-sim-report-agent/references/workspace_schema.md",
      "cad-sim-report-agent/scripts/analyze_workspace.py",
      "config-editor/SKILL.md",
      "config-editor/references/satellite-thermal-workspace.md",
      "config-editor/references/热仿真数据库.json",
      "config-editor/references/热仿真数据库_headers.md",
      "config-editor/templates/config_editor_report_template.md",
      "freecad/SKILL.md",
      "freecad/agents/openai.yaml",
      "freecad/guides/cad-build-workflow.md",
      "freecad/guides/cad-validate-workflow.md",
      "freecad/guides/create-assembly-from-component-info.md",
      "freecad/guides/safe-move-workflow.md",
      "planner/SKILL.md",
      "simulation-skill/SKILL.md",
      "simulation-skill/agents/openai.yaml",
    ]

    for (const relativePath of requiredFiles) {
      const filePath = path.join(THERMAL_SKILLS_DIR, relativePath)
      const stat = await fs.stat(filePath)
      assert.equal(stat.isFile(), true, `${relativePath} should be a file`)
      assert.ok(stat.size > 0, `${relativePath} should not be empty`)
    }

    const files = await listFiles(THERMAL_SKILLS_DIR)
    const emptyFiles = []
    for (const filePath of files) {
      const stat = await fs.stat(filePath)
      if (stat.size === 0) emptyFiles.push(path.relative(THERMAL_SKILLS_DIR, filePath))
    }
    assert.deepEqual(emptyFiles, [])
  })

  it("keeps the thermal component database valid JSON", async () => {
    const databasePath = path.join(THERMAL_SKILLS_DIR, "config-editor", "references", "热仿真数据库.json")
    const raw = await fs.readFile(databasePath, "utf-8")
    const parsed = JSON.parse(raw)

    assert.equal(typeof parsed, "object")
    assert.notEqual(parsed, null)
    assert.ok(Object.keys(parsed as Record<string, unknown>).length > 0)
  })

  it("exposes the FreeCAD CAD build CLI and its expected output contract", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "freecad-skill-smoke-"))
    try {
      const env = {
        ...process.env,
        PYTHONPATH: pythonPath(FREECAD_CLI_SRC_DIR, process.env.PYTHONPATH ?? ""),
      }
      const { stdout: rootHelp } = await execFileAsync("python3", [
        "-m",
        "freecad_cli_tools.cli.main",
        "--help",
      ], { env })
      const { stdout: buildHelp } = await execFileAsync("python3", [
        "-m",
        "freecad_cli_tools.cli.main",
        "cad",
        "build",
        "--help",
      ], { env })
      const { stdout: configStdout } = await execFileAsync("python3", [
        "-m",
        "freecad_cli_tools.cli.main",
        "config",
        "show",
        "--workspace-dir",
        workspaceDir,
      ], { env })
      const config = JSON.parse(configStdout)

      assert.match(rootHelp, /cad build/u)
      assert.match(rootHelp, /cad validate/u)
      assert.match(rootHelp, /progress update/u)
      assert.match(buildHelp, /--workspace(?:\s|,)/u)
      assert.match(buildHelp, /--real-cad-backend/u)
      assert.match(buildHelp, /geometry_after\.step\/\.glb/u)
      assert.match(buildHelp, /geometry_after_real_cad\.step\/\.glb/u)
      assert.equal(config.workspace_dir, workspaceDir)
      assert.equal(config.real_bom_path, path.join(workspaceDir, "00_inputs", "real_bom.json"))
      assert.equal(config.layout_topology_path, path.join(workspaceDir, "00_inputs", "layout_topology.json"))
      assert.equal(config.geom_path, path.join(workspaceDir, "00_inputs", "geom.json"))
      assert.equal(config.cad_output_dir, path.join(workspaceDir, "01_cad"))
      assert.equal(config.geometry_after_step_path, path.join(workspaceDir, "01_cad", "geometry_after.step"))
      assert.equal(config.geometry_after_layout_topology_path, path.join(workspaceDir, "01_cad", "geometry_after.layout_topology.json"))
      assert.equal(config.geometry_after_geom_path, path.join(workspaceDir, "01_cad", "geometry_after.geom.json"))
      assert.equal(config.artifact_registry_dir, path.join(workspaceDir, "logs", "registry"))
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it("exposes the simulation CLI and reports required inputs plus output directories", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "simulation-skill-smoke-"))
    try {
      await fs.mkdir(path.join(workspaceDir, "00_inputs"), { recursive: true })
      await fs.mkdir(path.join(workspaceDir, "01_cad"), { recursive: true })
      const env = {
        ...process.env,
        PYTHONPATH: pythonPath(SIM_CLI_SRC_DIR, SIM_RUNTIME_DIR, process.env.PYTHONPATH ?? ""),
      }
      const { stdout: rootHelp } = await execFileAsync("python3", [
        "-m",
        "sim_cli_tools.cli.main",
        "--help",
      ], { env })
      const { stdout: runHelp } = await execFileAsync("python3", [
        "-m",
        "sim_cli_tools.cli.main",
        "run",
        "--help",
      ], { env })
      const doctorStdout = await execFileForStdout("python3", [
        "-m",
        "sim_cli_tools.cli.main",
        "--json",
        "doctor",
        "--workspace-dir",
        workspaceDir,
      ], { env })
      const doctor = JSON.parse(doctorStdout)

      assert.match(rootHelp, /doctor/u)
      assert.match(rootHelp, /run/u)
      assert.match(runHelp, /--workspace-dir/u)
      assert.match(runHelp, /comsol_local/u)
      assert.match(runHelp, /mock_contract/u)
      assert.match(runHelp, /--async-open-tools/u)
      assert.equal(doctor.ok, false)
      assert.equal(doctor.paths.workspace_dir, workspaceDir)
      assert.deepEqual(doctor.outputs, {
        analysis: path.join(workspaceDir, "02_sim", "analysis"),
        case_build: path.join(workspaceDir, "02_sim", "case_build"),
        postprocess: path.join(workspaceDir, "02_sim", "postprocess"),
        root: path.join(workspaceDir, "02_sim"),
        simulation: path.join(workspaceDir, "02_sim", "simulation"),
      })
      assert.deepEqual(doctor.missing_files, [
        path.join(workspaceDir, "00_inputs", "real_bom.json"),
        path.join(workspaceDir, "00_inputs", "layout_topology.json"),
        path.join(workspaceDir, "00_inputs", "geom.json"),
        path.join(workspaceDir, "01_cad", "geometry_after.step"),
        path.join(workspaceDir, "01_cad", "geometry_after.geom.json"),
        path.join(workspaceDir, "01_cad", "geometry_after.layout_topology.json"),
        path.join(workspaceDir, "01_cad", "geometry_after_registry.json"),
        path.join(workspaceDir, "01_cad", "simulation_input.json"),
        path.join(workspaceDir, "01_cad", "comsol_inputs", "coord.txt"),
        path.join(workspaceDir, "01_cad", "comsol_inputs", "channels_input.npz"),
      ])
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it("runs the CAD simulation report analyzer and writes expected outputs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "thermal-skill-smoke-"))
    const reportDir = path.join(workspaceDir, "reports")
    try {
      await fs.mkdir(path.join(workspaceDir, "00_inputs"), { recursive: true })
      await fs.mkdir(path.join(workspaceDir, "01_cad"), { recursive: true })
      await fs.mkdir(path.join(workspaceDir, "02_sim", "simulation"), { recursive: true })
      await fs.mkdir(path.join(workspaceDir, "logs"), { recursive: true })
      await fs.writeFile(path.join(workspaceDir, "01_cad", "geometry_after.step"), "demo step\n", "utf-8")
      await fs.writeFile(path.join(workspaceDir, "01_cad", "geometry_after.glb"), "demo glb\n", "utf-8")

      const scriptPath = path.join(
        THERMAL_SKILLS_DIR,
        "cad-sim-report-agent",
        "scripts",
        "analyze_workspace.py",
      )
      const { stdout } = await execFileAsync("python3", [
        scriptPath,
        "--workspace",
        workspaceDir,
        "--out-dir",
        reportDir,
      ])
      const payload = JSON.parse(stdout)

      assert.equal(payload.ok, true)
      assert.equal(payload.outputs.report, path.join(reportDir, "report.md"))
      assert.equal(payload.outputs.modifications, path.join(reportDir, "modifications.md"))
      assert.equal(payload.outputs.summary_json, path.join(reportDir, "summary.json"))

      for (const fileName of ["report.md", "modifications.md", "summary.json"]) {
        const stat = await fs.stat(path.join(reportDir, fileName))
        assert.ok(stat.size > 0, `${fileName} should not be empty`)
      }
    } finally {
      await fs.rm(workspaceDir, { force: true, recursive: true })
    }
  })
})

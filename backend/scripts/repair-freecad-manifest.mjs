import fs from "node:fs/promises"
import path from "node:path"

const [, , manifestArg] = process.argv

if (!manifestArg) {
  console.error("Usage: node scripts/repair-freecad-manifest.mjs <manifest.json>")
  process.exit(1)
}

const manifestPath = path.resolve(manifestArg)
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"))
const docName = manifest?.inputs?.doc_name

if (typeof docName !== "string" || docName.trim() === "") {
  console.error("Manifest does not include inputs.doc_name")
  process.exit(1)
}

const safeDocName = docName
  .split("")
  .map(char => /[A-Za-z0-9_-]/u.test(char) ? char : "_")
  .join("")
  .replace(/^_+|_+$/gu, "") || "assembly"
const stem = manifest?.operation?.tool === "freecad-create-assembly-from-component-info" ||
  manifest?.operation?.type === "create_component_info_assembly" ||
  manifest?.inputs?.input_format === "component_info_assembly"
  ? "component_info_assembly"
  : "geometry_after"

const registryDir = path.resolve(manifestPath, "..", "..")
const workspaceDir = path.resolve(registryDir, "..", "..")
const outputsDir = path.join(workspaceDir, "assembly_builds", safeDocName, "outputs")
const stepPath = path.join(outputsDir, `${stem}.step`)
const glbPath = path.join(outputsDir, `${stem}.glb`)

const [stepStat, glbStat] = await Promise.all([
  fs.stat(stepPath).catch(() => null),
  fs.stat(glbPath).catch(() => null),
])

if (!stepStat && !glbStat) {
  console.error(`No repairable artifacts found under ${outputsDir}`)
  process.exit(1)
}

const progress = {
  layout_completion_percent: 100,
  modeling_percent: 100,
  export_file_percent: stepStat && glbStat ? 100 : 50,
}
const nextOutputs = { ...(manifest.outputs ?? {}) }
const nextResult = { ...(manifest.result ?? {}) }

if (stepStat) {
  nextOutputs.step_path = stepPath
  nextResult.save_path = stepPath
}
if (glbStat) {
  nextOutputs.glb_path = glbPath
  nextResult.glb_path = glbPath
}

manifest.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z")
manifest.operation = {
  ...(manifest.operation ?? {}),
  status: stepStat && glbStat ? "success" : "partial_success",
}
manifest.outputs = nextOutputs
manifest.artifacts = [
  ...(Array.isArray(manifest.artifacts) ? manifest.artifacts.filter(item =>
    (stepStat || item?.kind !== "step") && (glbStat || item?.kind !== "glb")
  ) : []),
  ...(stepStat ? [{ kind: "step", path: stepPath, exists: true }] : []),
  ...(glbStat ? [{ kind: "glb", path: glbPath, exists: true }] : []),
]
manifest.result = {
  ...nextResult,
  success: Boolean(stepStat && glbStat),
  document: manifest.result?.document ?? docName,
  progress_percentages: progress,
  ...progress,
}
manifest.error = stepStat && glbStat
  ? null
  : {
    code: "REPAIRED_PARTIAL_ARTIFACTS",
    message: "Manifest was repaired from existing assembly_builds artifacts, but not all expected files were present.",
  }

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8")
console.log(`Repaired ${manifestPath}`)

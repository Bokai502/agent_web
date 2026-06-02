import fs from "node:fs/promises"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import { getErrorMessage } from "../shared/index.js"
import {
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceDir,
} from "../workspaces/index.js"

const GNC_INPUTS_DIRNAME = "00_inputs"
const GNC_CONFIG_DIRNAME = "Config"

type WorkspaceQuery = {
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

type SaveBody = WorkspaceQuery & {
  payload?: unknown
}

type GncConfigPayload = {
  sim: Record<string, unknown>
  orbits: Array<Record<string, unknown>>
  spacecraft: Array<Record<string, unknown>>
  resolution: Record<string, unknown>
}

type RawLine = {
  __rawLine: string
}

async function getInputsDir(workspaceDir: string) {
  const inputsDir = path.join(workspaceDir, GNC_INPUTS_DIRNAME)
  const configDir = path.join(inputsDir, GNC_CONFIG_DIRNAME)
  const configSimFile = path.join(configDir, "Inp_Sim.txt")
  if (await fs.stat(configSimFile).then(stat => stat.isFile()).catch(() => false)) {
    return configDir
  }
  return inputsDir
}

function stripComment(line: string) {
  return line.includes("!") ? line.split("!", 1)[0].trim() : line.trim()
}

function isBanner(line: string) {
  const value = line.trim()
  return (
    value.startsWith("<") ||
    value.startsWith("*") ||
    value.startsWith("=") ||
    value.startsWith(":") ||
    value.startsWith("(") ||
    /^[-=]{3,}$/u.test(value)
  )
}

function tokenize(line: string) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/gu)].map(match => match[1] ?? match[2] ?? match[0])
}

function toNumber(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toInt(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function toBool(value: string | undefined) {
  if (value === "TRUE") return true
  if (value === "FALSE") return false
  return value ?? ""
}

function vec(tokens: string[], start = 0, count = tokens.length - start) {
  return tokens.slice(start, start + count).map(toNumber)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function rec(value: unknown) {
  return isRecord(value) ? value : {}
}

function arr(value: unknown) {
  return Array.isArray(value) ? value : []
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : toNumber(String(value ?? "0"))
}

function int(value: unknown) {
  return Math.trunc(num(value))
}

function boolText(value: unknown) {
  return value === true ? "TRUE" : value === false ? "FALSE" : String(value ?? "")
}

function rawLine(value: string): RawLine {
  return { __rawLine: value }
}

function isRawLine(value: unknown): value is RawLine {
  return isRecord(value) && typeof value.__rawLine === "string"
}

function formatValue(value: unknown) {
  if (isRawLine(value)) return value.__rawLine
  if (typeof value === "boolean") return boolText(value)
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)))
  if (typeof value === "string" && /\s/u.test(value)) return `"${value.replace(/"/gu, '\\"')}"`
  return String(value ?? "")
}

function formatToken(value: unknown) {
  if (typeof value === "boolean") return boolText(value)
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)))
  return String(value ?? "")
}

function formatSeq(values: unknown[]) {
  return rawLine(values.map(formatToken).join("  "))
}

class ConfigReader {
  lines: string[]
  index = 0

  constructor(raw: string) {
    this.lines = raw
      .split(/\r?\n/u)
      .map(stripComment)
      .filter(Boolean)
  }

  private skipBanners() {
    while (this.index < this.lines.length && isBanner(this.lines[this.index] ?? "")) this.index += 1
  }

  nextLine() {
    this.skipBanners()
    if (this.index >= this.lines.length) throw new Error("Unexpected EOF while parsing GNC config")
    const line = this.lines[this.index] ?? ""
    this.index += 1
    return line
  }

  nextTokens() {
    return tokenize(this.nextLine())
  }

  skipLines(count: number) {
    for (let index = 0; index < count; index += 1) this.nextLine()
  }
}

class ConfigLineEditor {
  lines: string[]
  index = 0

  constructor(raw: string) {
    this.lines = raw.split(/\r?\n/u)
  }

  private clean(line: string) {
    return stripComment(line)
  }

  private nextDataLineIndex() {
    while (this.index < this.lines.length) {
      const clean = this.clean(this.lines[this.index] ?? "")
      if (clean && !isBanner(clean)) return this.index++
      this.index += 1
    }
    throw new Error("Unexpected EOF while writing GNC config")
  }

  replace(value: unknown) {
    const lineIndex = this.nextDataLineIndex()
    const raw = this.lines[lineIndex] ?? ""
    const commentIndex = raw.indexOf("!")
    const text = formatValue(value)
    this.lines[lineIndex] = commentIndex >= 0
      ? `${text.padEnd(30)}${raw.slice(commentIndex)}`
      : text
  }

  skip(count: number) {
    for (let index = 0; index < count; index += 1) this.nextDataLineIndex()
  }

  text() {
    return this.lines.join("\n")
  }
}

async function readConfigFile(configDir: string, fileName: string) {
  const fullPath = path.resolve(configDir, fileName)
  const relative = path.relative(configDir, fullPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Config reference escapes config directory: ${fileName}`)
  }
  return await fs.readFile(fullPath, "utf-8")
}

async function writeConfigFile(configDir: string, fileName: string, content: string) {
  const fullPath = path.resolve(configDir, fileName)
  const relative = path.relative(configDir, fullPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Config reference escapes config directory: ${fileName}`)
  }
  await fs.writeFile(fullPath, content, "utf-8")
}

async function parseSim(configDir: string) {
  const file = "Inp_Sim.txt"
  const r = new ConfigReader(await readConfigFile(configDir, file))
  const sim: Record<string, unknown> = { file }
  sim.time_mode = r.nextTokens()[0] ?? ""
  let tokens = r.nextTokens()
  sim.stop_time_s = toNumber(tokens[0])
  sim.dt_sim_s = toNumber(tokens[1])
  sim.dTout_s = toNumber(r.nextTokens()[0])
  sim.rng_seed = toInt(r.nextTokens()[0])
  sim.gl_enable = toBool(r.nextTokens()[0])
  sim.cmd_file = r.nextTokens()[0] ?? ""

  const orbitCount = toInt(r.nextTokens()[0])
  const referenceOrbits: Array<Record<string, unknown>> = []
  for (let index = 0; index < orbitCount; index += 1) {
    tokens = r.nextTokens()
    referenceOrbits.push({ exists: toBool(tokens[0]), file: tokens[1] ?? "", index })
  }
  sim.reference_orbits = referenceOrbits

  const spacecraftCount = toInt(r.nextTokens()[0])
  const spacecraft: Array<Record<string, unknown>> = []
  for (let index = 0; index < spacecraftCount; index += 1) {
    tokens = r.nextTokens()
    spacecraft.push({
      exists: toBool(tokens[0]),
      file: tokens[2] ?? "",
      index,
      ref_orbit: toInt(tokens[1]),
    })
  }
  sim.spacecraft = spacecraft

  tokens = r.nextTokens()
  sim.utc_date = { month: toInt(tokens[0]), day: toInt(tokens[1]), year: toInt(tokens[2]) }
  tokens = r.nextTokens()
  sim.utc_time = { hour: toInt(tokens[0]), minute: toInt(tokens[1]), second: toNumber(tokens[2]) }
  sim.leap_seconds = toNumber(r.nextTokens()[0])
  sim.atmo_option = r.nextTokens()[0] ?? ""
  sim.flux10p7 = toNumber(r.nextTokens()[0])
  sim.geomag_index = toNumber(r.nextTokens()[0])
  tokens = r.nextTokens()
  sim.mag_model = { type: tokens[0] ?? "", n: null, m: null }
  tokens = r.nextTokens()
  sim.mag_model = { ...(sim.mag_model as Record<string, unknown>), n: toInt(tokens[0]), m: toInt(tokens[1]) }
  tokens = r.nextTokens()
  sim.earth_gravity_model = { n: toInt(tokens[0]), m: toInt(tokens[1]) }
  tokens = r.nextTokens()
  sim.mars_gravity_model = { n: toInt(tokens[0]), m: toInt(tokens[1]) }
  tokens = r.nextTokens()
  sim.luna_gravity_model = { n: toInt(tokens[0]), m: toInt(tokens[1]) }
  for (const key of [
    "aero_active", "gg_active", "sol_press_active", "residual_dipole_active",
    "grav_pert_active", "thruster_plumes_active", "contact_active", "slosh_active",
    "albedo_active", "compute_env_trq",
  ]) {
    tokens = r.nextTokens()
    sim[key] = toBool(tokens[0])
    if (key === "aero_active") sim.aero_shadows_active = toBool(tokens[1])
    if (key === "sol_press_active") sim.sol_press_shadows_active = toBool(tokens[1])
  }
  sim.ephem_option = r.nextTokens()[0] ?? ""

  return sim
}

async function parseOrbit(configDir: string, file: string) {
  const r = new ConfigReader(await readConfigFile(configDir, file))
  const orbit: Record<string, unknown> = { file }
  orbit.description = r.nextLine()
  orbit.regime = r.nextTokens()[0] ?? ""
  orbit.zero = { world: r.nextTokens()[0] ?? "", polyhedron_gravity_enabled: toBool(r.nextTokens()[0]) }
  orbit.flight = { region_number: toInt(r.nextTokens()[0]), polyhedron_gravity_enabled: toBool(r.nextTokens()[0]) }
  const central: Record<string, unknown> = {}
  central.world = r.nextTokens()[0] ?? ""
  central.j2_drift_enabled = toBool(r.nextTokens()[0])
  central.input_type = r.nextTokens()[0] ?? ""
  const kep: Record<string, unknown> = {}
  kep.use_pa = r.nextTokens()[0] ?? ""
  kep.periapsis_apoapsis_km = vec(r.nextTokens(), 0, 2)
  kep.min_altitude_eccentricity = vec(r.nextTokens(), 0, 2)
  kep.inclination_deg = toNumber(r.nextTokens()[0])
  kep.raan_deg = toNumber(r.nextTokens()[0])
  kep.argp_deg = toNumber(r.nextTokens()[0])
  kep.true_anomaly_deg = toNumber(r.nextTokens()[0])
  central.kep = kep
  central.rv = { position_km: vec(r.nextTokens(), 0, 3), velocity_km_s: vec(r.nextTokens(), 0, 3) }
  central.file_input = { element_type: r.nextTokens()[0] ?? "", element_file: r.nextTokens()[0] ?? "", element_label: r.nextTokens()[0] ?? "" }
  orbit.central = central
  return orbit
}

function parseCountedItems<T>(r: ConfigReader, count: number, parser: (index: number) => T) {
  const items: T[] = []
  for (let index = 0; index < count; index += 1) items.push(parser(index))
  return items
}

async function parseSpacecraft(configDir: string, file: string) {
  const r = new ConfigReader(await readConfigFile(configDir, file))
  const sc: Record<string, unknown> = { file }
  sc.description = r.nextLine()
  sc.label = r.nextTokens()[0] ?? ""
  sc.sprite_file = r.nextTokens()[0] ?? ""
  sc.fsw_tag = r.nextTokens()[0] ?? ""
  sc.fsw_sample_time_s = toNumber(r.nextTokens()[0])
  sc.orbit_parameters = {
    orb_dof: r.nextTokens()[0] ?? "",
    use_cm: r.nextTokens()[0] ?? "",
    pos_vec_m: vec(r.nextTokens(), 0, 3),
    vel_vec_m_s: vec(r.nextTokens(), 0, 3),
  }
  sc.initial_attitude = {
    mode_code: r.nextTokens()[0] ?? "",
    angular_rate_deg_s: vec(r.nextTokens(), 0, 3),
    quaternion: vec(r.nextTokens(), 0, 4),
    euler_angles_deg_seq: (() => {
      const tokens = r.nextTokens()
      return [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])]
    })(),
  }
  sc.dynamics_flags = {
    dyn_method: r.nextTokens()[0] ?? "",
    constraints_requested: toBool(r.nextTokens()[0]),
    ref_pt: r.nextTokens()[0] ?? "",
    flex_active: toBool(r.nextTokens()[0]),
    include_second_order_flex_terms: toBool(r.nextTokens()[0]),
    shaker_file: r.nextTokens()[0] ?? "",
    drag_coef: toNumber(r.nextTokens()[0]),
  }

  const bodyCount = toInt(r.nextTokens()[0])
  sc.body_count = bodyCount
  sc.bodies = parseCountedItems(r, bodyCount, index => ({
    index,
    mass_kg: toNumber(r.nextTokens()[0]),
    inertia_diag_kg_m2: vec(r.nextTokens(), 0, 3),
    inertia_products_kg_m2: vec(r.nextTokens(), 0, 3),
    cm_m: vec(r.nextTokens(), 0, 3),
    embedded_momentum_nms: vec(r.nextTokens(), 0, 3),
    embedded_dipole_a_m2: vec(r.nextTokens(), 0, 3),
    mesh_file: r.nextTokens()[0] ?? "",
    node_file: r.nextTokens()[0] ?? "",
    flex_file: r.nextTokens()[0] ?? "",
  }))

  const jointCount = Math.max(0, bodyCount - 1)
  sc.joint_count = jointCount
  sc.joints = parseCountedItems(r, jointCount, index => {
    const joint: Record<string, unknown> = { index, type: r.nextTokens()[0] ?? "" }
    let tokens = r.nextTokens()
    joint.bin = toInt(tokens[0])
    joint.bout = toInt(tokens[1])
    tokens = r.nextTokens()
    joint.rot_dof = toInt(tokens[0])
    joint.rot_seq = toInt(tokens[1])
    joint.joint_shape = tokens[2] ?? ""
    tokens = r.nextTokens()
    joint.trn_dof = toInt(tokens[0])
    joint.trn_seq = toInt(tokens[1])
    joint.rot_locked = r.nextTokens().map(toBool)
    joint.trn_locked = r.nextTokens().map(toBool)
    joint.initial_angles_deg = vec(r.nextTokens(), 0, 3)
    joint.initial_ang_rates_deg_s = vec(r.nextTokens(), 0, 3)
    joint.initial_displacements_m = vec(r.nextTokens(), 0, 3)
    joint.initial_displacement_rates_m_s = vec(r.nextTokens(), 0, 3)
    tokens = r.nextTokens()
    joint.bi_to_gi_static_angles_deg_seq = [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])]
    tokens = r.nextTokens()
    joint.go_to_bo_static_angles_deg_seq = [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])]
    joint.position_wrt_inner_body_origin_m = vec(r.nextTokens(), 0, 3)
    joint.position_wrt_outer_body_origin_m = vec(r.nextTokens(), 0, 3)
    joint.parm_file = r.nextTokens()[0] ?? ""
    return joint
  })

  sc.wheels = { drag_active: toBool(r.nextTokens()[0]), jitter_active: toBool(r.nextTokens()[0]) }
  const wheelCount = toInt(r.nextTokens()[0])
  ;(sc.wheels as Record<string, unknown>).count = wheelCount
  ;(sc.wheels as Record<string, unknown>).items = parseCountedItems(r, wheelCount, index => {
    let tokens = r.nextTokens()
    const wheel: Record<string, unknown> = { index, initial_momentum_nms: toNumber(tokens[0]) }
    wheel.axis = vec(r.nextTokens(), 0, 3)
    tokens = r.nextTokens()
    wheel.tmax_n_m = toNumber(tokens[0])
    wheel.hmax_n_m_s = toNumber(tokens[1])
    wheel.rotor_inertia_kg_m2 = toNumber(r.nextTokens()[0])
    wheel.body = toInt(r.nextTokens()[0])
    wheel.node = toInt(r.nextTokens()[0])
    wheel.drag_jitter_file = r.nextTokens()[0] ?? ""
    return wheel
  })

  const collectionParsers: Array<[string, number, (count: number) => unknown[]]> = [
    ["mtbs", 3, count => parseCountedItems(r, count, index => ({ index, mmax_a_m2: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), node: toInt(r.nextTokens()[0]) }))],
    ["thrusters", 5, count => parseCountedItems(r, count, index => ({ index, mode: r.nextTokens()[0] ?? "", fmax_n: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), body: toInt(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["gyros", 10, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), max_rate_deg_s: toNumber(r.nextTokens()[0]), scale_error_ppm: toNumber(r.nextTokens()[0]), quantization_arcsec: toNumber(r.nextTokens()[0]), angle_random_walk_deg_rt_hr: toNumber(r.nextTokens()[0]), bias_stability_deg_hr_and_timespan_hr: vec(r.nextTokens(), 0, 2), angle_noise_arcsec_rms: toNumber(r.nextTokens()[0]), initial_bias_deg_hr: toNumber(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["magnetometers", 7, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), saturation_tesla: toNumber(r.nextTokens()[0]), scale_error_ppm: toNumber(r.nextTokens()[0]), quantization_tesla: toNumber(r.nextTokens()[0]), noise_tesla_rms: toNumber(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["css", 7, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), fov_half_angle_deg: toNumber(r.nextTokens()[0]), scale: toNumber(r.nextTokens()[0]), quantization: toNumber(r.nextTokens()[0]), body: toInt(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["fss", 7, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), mounting_angles_deg_seq: (() => { const tokens = r.nextTokens(); return [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])] })(), bore_axis: r.nextTokens()[0] ?? "", fov_size_deg: vec(r.nextTokens(), 0, 2), nea_deg_rms: toNumber(r.nextTokens()[0]), quantization_deg: toNumber(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["star_trackers", 7, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), mounting_angles_deg_seq: (() => { const tokens = r.nextTokens(); return [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])] })(), bore_axis: r.nextTokens()[0] ?? "", fov_size_deg: vec(r.nextTokens(), 0, 2), sun_earth_moon_exclusion_deg: vec(r.nextTokens(), 0, 3), nea_arcsec_rms: vec(r.nextTokens(), 0, 3), node: toInt(r.nextTokens()[0]) }))],
    ["gps", 5, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), position_noise_m_rms: toNumber(r.nextTokens()[0]), velocity_noise_m_s_rms: toNumber(r.nextTokens()[0]), time_noise_s_rms: toNumber(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["accelerometers", 10, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), axis: vec(r.nextTokens(), 0, 3), max_acceleration_m_s2: toNumber(r.nextTokens()[0]), scale_error_ppm: toNumber(r.nextTokens()[0]), quantization_m_s2: toNumber(r.nextTokens()[0]), dv_random_walk_m_s_rt_hr: toNumber(r.nextTokens()[0]), bias_stability_m_s2_and_timespan_hr: vec(r.nextTokens(), 0, 2), dv_noise_m_s: toNumber(r.nextTokens()[0]), initial_bias_m_s2: toNumber(r.nextTokens()[0]), node: toInt(r.nextTokens()[0]) }))],
    ["fgs", 10, count => parseCountedItems(r, count, index => ({ index, sample_time_s: toNumber(r.nextTokens()[0]), mounting_angles_deg_seq: (() => { const tokens = r.nextTokens(); return [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])] })(), bore_axis: r.nextTokens()[0] ?? "", fov_size_arcsec: vec(r.nextTokens(), 0, 2), nea_arcsec_rms: toNumber(r.nextTokens()[0]), detector_scale_arcsec_pixel: toNumber(r.nextTokens()[0]), body_node: r.nextTokens().map(toInt), fov_frame_angles_deg_seq: (() => { const tokens = r.nextTokens(); return [toNumber(tokens[0]), toNumber(tokens[1]), toNumber(tokens[2]), toInt(tokens[3])] })(), guide_star_hv_deg: vec(r.nextTokens(), 0, 2), optics_file: r.nextTokens()[0] ?? "", psf_image_file: r.nextTokens()[0] ?? "" }))],
  ]
  for (const [key, zeroTemplateLines, parser] of collectionParsers) {
    const count = toInt(r.nextTokens()[0])
    if (count === 0) {
      r.skipLines(zeroTemplateLines)
      sc[key] = { count, items: [] }
      continue
    }
    sc[key] = { count, items: parser(count) }
  }
  return sc
}

async function parseConfig(configDir: string): Promise<GncConfigPayload> {
  const sim = await parseSim(configDir)
  const orbitRefs = Array.isArray(sim.reference_orbits) ? sim.reference_orbits as Array<Record<string, unknown>> : []
  const spacecraftRefs = Array.isArray(sim.spacecraft) ? sim.spacecraft as Array<Record<string, unknown>> : []
  const orbitFiles = orbitRefs.map(ref => String(ref.file ?? "")).filter(Boolean)
  const spacecraftFiles = spacecraftRefs.map(ref => String(ref.file ?? "")).filter(Boolean)
  return {
    sim,
    orbits: await Promise.all(orbitFiles.map(file => parseOrbit(configDir, file))),
    spacecraft: await Promise.all(spacecraftFiles.map(file => parseSpacecraft(configDir, file))),
    resolution: {
      sim_file: path.join(configDir, "Inp_Sim.txt"),
      orbit_files_from_sim: orbitFiles.map(file => path.join(configDir, file)),
      spacecraft_files_from_sim: spacecraftFiles.map(file => path.join(configDir, file)),
    },
  }
}

async function writeSim(configDir: string, sim: Record<string, unknown>) {
  const file = String(sim.file ?? "Inp_Sim.txt")
  const editor = new ConfigLineEditor(await readConfigFile(configDir, file))
  editor.replace(sim.time_mode)
  editor.replace(formatSeq([sim.stop_time_s, sim.dt_sim_s]))
  editor.replace(sim.dTout_s)
  editor.replace(sim.rng_seed)
  editor.replace(sim.gl_enable)
  editor.replace(sim.cmd_file)
  const orbitRefs = arr(sim.reference_orbits).map(rec)
  editor.replace(orbitRefs.length)
  for (const ref of orbitRefs) editor.replace(formatSeq([boolText(ref.exists), ref.file]))
  const spacecraftRefs = arr(sim.spacecraft).map(rec)
  editor.replace(spacecraftRefs.length)
  for (const item of spacecraftRefs) editor.replace(formatSeq([boolText(item.exists), item.ref_orbit, item.file]))
  const utcDate = rec(sim.utc_date)
  editor.replace(formatSeq([utcDate.month, utcDate.day, utcDate.year]))
  const utcTime = rec(sim.utc_time)
  editor.replace(formatSeq([utcTime.hour, utcTime.minute, utcTime.second]))
  editor.replace(sim.leap_seconds)
  editor.replace(sim.atmo_option)
  editor.replace(sim.flux10p7)
  editor.replace(sim.geomag_index)
  const magModel = rec(sim.mag_model)
  editor.replace(magModel.type)
  editor.replace(formatSeq([magModel.n, magModel.m]))
  const earthGravity = rec(sim.earth_gravity_model)
  editor.replace(formatSeq([earthGravity.n, earthGravity.m]))
  const marsGravity = rec(sim.mars_gravity_model)
  editor.replace(formatSeq([marsGravity.n, marsGravity.m]))
  const lunaGravity = rec(sim.luna_gravity_model)
  editor.replace(formatSeq([lunaGravity.n, lunaGravity.m]))
  editor.replace(formatSeq([boolText(sim.aero_active), boolText(sim.aero_shadows_active)]))
  editor.replace(sim.gg_active)
  editor.replace(formatSeq([boolText(sim.sol_press_active), boolText(sim.sol_press_shadows_active)]))
  for (const key of [
    "residual_dipole_active", "grav_pert_active", "thruster_plumes_active", "contact_active",
    "slosh_active", "albedo_active", "compute_env_trq",
  ]) editor.replace(sim[key])
  editor.replace(sim.ephem_option)
  await writeConfigFile(configDir, file, editor.text())
}

async function writeOrbit(configDir: string, orbit: Record<string, unknown>) {
  const file = String(orbit.file ?? "")
  if (!file) return
  const editor = new ConfigLineEditor(await readConfigFile(configDir, file))
  const central = rec(orbit.central)
  const kep = rec(central.kep)
  const rv = rec(central.rv)
  const fileInput = rec(central.file_input)
  editor.replace(orbit.description)
  editor.replace(orbit.regime)
  editor.skip(4)
  editor.replace(central.world)
  editor.replace(central.j2_drift_enabled)
  editor.replace(central.input_type)
  editor.replace(kep.use_pa)
  editor.replace(formatSeq(arr(kep.periapsis_apoapsis_km)))
  editor.replace(formatSeq(arr(kep.min_altitude_eccentricity)))
  editor.replace(kep.inclination_deg)
  editor.replace(kep.raan_deg)
  editor.replace(kep.argp_deg)
  editor.replace(kep.true_anomaly_deg)
  editor.replace(formatSeq(arr(rv.position_km)))
  editor.replace(formatSeq(arr(rv.velocity_km_s)))
  editor.replace(fileInput.element_type)
  editor.replace(fileInput.element_file)
  editor.replace(fileInput.element_label)
  await writeConfigFile(configDir, file, editor.text())
}

function writeSpacecraftCollections(editor: ConfigLineEditor, sc: Record<string, unknown>) {
  const wheels = rec(sc.wheels)
  editor.replace(wheels.drag_active)
  editor.replace(wheels.jitter_active)
  const wheelItems = arr(wheels.items).map(rec)
  editor.replace(wheelItems.length)
  for (const item of wheelItems) {
    editor.replace(item.initial_momentum_nms)
    editor.replace(formatSeq(arr(item.axis)))
    editor.replace(formatSeq([item.tmax_n_m, item.hmax_n_m_s]))
    editor.replace(item.rotor_inertia_kg_m2)
    editor.replace(item.body)
    editor.replace(item.node)
    editor.replace(item.drag_jitter_file)
  }

  const collectionWriters: Array<[string, number, (item: Record<string, unknown>) => void]> = [
    ["mtbs", 3, item => { editor.replace(item.mmax_a_m2); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.node) }],
    ["thrusters", 5, item => { editor.replace(item.mode); editor.replace(item.fmax_n); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.body); editor.replace(item.node) }],
    ["gyros", 10, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.max_rate_deg_s); editor.replace(item.scale_error_ppm); editor.replace(item.quantization_arcsec); editor.replace(item.angle_random_walk_deg_rt_hr); editor.replace(formatSeq(arr(item.bias_stability_deg_hr_and_timespan_hr))); editor.replace(item.angle_noise_arcsec_rms); editor.replace(item.initial_bias_deg_hr); editor.replace(item.node) }],
    ["magnetometers", 7, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.saturation_tesla); editor.replace(item.scale_error_ppm); editor.replace(item.quantization_tesla); editor.replace(item.noise_tesla_rms); editor.replace(item.node) }],
    ["css", 7, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.fov_half_angle_deg); editor.replace(item.scale); editor.replace(item.quantization); editor.replace(item.body); editor.replace(item.node) }],
    ["fss", 7, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.mounting_angles_deg_seq))); editor.replace(item.bore_axis); editor.replace(formatSeq(arr(item.fov_size_deg))); editor.replace(item.nea_deg_rms); editor.replace(item.quantization_deg); editor.replace(item.node) }],
    ["star_trackers", 7, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.mounting_angles_deg_seq))); editor.replace(item.bore_axis); editor.replace(formatSeq(arr(item.fov_size_deg))); editor.replace(formatSeq(arr(item.sun_earth_moon_exclusion_deg))); editor.replace(formatSeq(arr(item.nea_arcsec_rms))); editor.replace(item.node) }],
    ["gps", 5, item => { editor.replace(item.sample_time_s); editor.replace(item.position_noise_m_rms); editor.replace(item.velocity_noise_m_s_rms); editor.replace(item.time_noise_s_rms); editor.replace(item.node) }],
    ["accelerometers", 10, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.axis))); editor.replace(item.max_acceleration_m_s2); editor.replace(item.scale_error_ppm); editor.replace(item.quantization_m_s2); editor.replace(item.dv_random_walk_m_s_rt_hr); editor.replace(formatSeq(arr(item.bias_stability_m_s2_and_timespan_hr))); editor.replace(item.dv_noise_m_s); editor.replace(item.initial_bias_m_s2); editor.replace(item.node) }],
    ["fgs", 10, item => { editor.replace(item.sample_time_s); editor.replace(formatSeq(arr(item.mounting_angles_deg_seq))); editor.replace(item.bore_axis); editor.replace(formatSeq(arr(item.fov_size_arcsec))); editor.replace(item.nea_arcsec_rms); editor.replace(item.detector_scale_arcsec_pixel); editor.replace(formatSeq(arr(item.body_node))); editor.replace(formatSeq(arr(item.fov_frame_angles_deg_seq))); editor.replace(formatSeq(arr(item.guide_star_hv_deg))); editor.replace(item.optics_file); editor.replace(item.psf_image_file) }],
  ]
  for (const [key, zeroTemplateLines, writeItem] of collectionWriters) {
    const block = rec(sc[key])
    const items = arr(block.items).map(rec)
    editor.replace(items.length)
    if (items.length === 0) {
      editor.skip(zeroTemplateLines)
      continue
    }
    for (const item of items) writeItem(item)
  }
}

async function writeSpacecraft(configDir: string, sc: Record<string, unknown>) {
  const file = String(sc.file ?? "")
  if (!file) return
  const editor = new ConfigLineEditor(await readConfigFile(configDir, file))
  const orbitParameters = rec(sc.orbit_parameters)
  const initialAttitude = rec(sc.initial_attitude)
  const dynamicsFlags = rec(sc.dynamics_flags)
  editor.replace(sc.description)
  editor.replace(sc.label)
  editor.replace(sc.sprite_file)
  editor.replace(sc.fsw_tag)
  editor.replace(sc.fsw_sample_time_s)
  editor.replace(orbitParameters.orb_dof)
  editor.replace(orbitParameters.use_cm)
  editor.replace(formatSeq(arr(orbitParameters.pos_vec_m)))
  editor.replace(formatSeq(arr(orbitParameters.vel_vec_m_s)))
  editor.replace(initialAttitude.mode_code)
  editor.replace(formatSeq(arr(initialAttitude.angular_rate_deg_s)))
  editor.replace(formatSeq(arr(initialAttitude.quaternion)))
  editor.replace(formatSeq(arr(initialAttitude.euler_angles_deg_seq)))
  editor.replace(dynamicsFlags.dyn_method)
  editor.replace(dynamicsFlags.constraints_requested)
  editor.replace(dynamicsFlags.ref_pt)
  editor.replace(dynamicsFlags.flex_active)
  editor.replace(dynamicsFlags.include_second_order_flex_terms)
  editor.replace(dynamicsFlags.shaker_file)
  editor.replace(dynamicsFlags.drag_coef)
  const bodies = arr(sc.bodies).map(rec)
  editor.replace(bodies.length)
  for (const body of bodies) {
    editor.replace(body.mass_kg)
    editor.replace(formatSeq(arr(body.inertia_diag_kg_m2)))
    editor.replace(formatSeq(arr(body.inertia_products_kg_m2)))
    editor.replace(formatSeq(arr(body.cm_m)))
    editor.replace(formatSeq(arr(body.embedded_momentum_nms)))
    editor.replace(formatSeq(arr(body.embedded_dipole_a_m2)))
    editor.replace(body.mesh_file)
    editor.replace(body.node_file)
    editor.replace(body.flex_file)
  }
  for (const joint of arr(sc.joints).map(rec)) {
    editor.replace(joint.type)
    editor.replace(formatSeq([joint.bin, joint.bout]))
    editor.replace(formatSeq([joint.rot_dof, joint.rot_seq, joint.joint_shape]))
    editor.replace(formatSeq([joint.trn_dof, joint.trn_seq]))
    editor.replace(formatSeq(arr(joint.rot_locked).map(boolText)))
    editor.replace(formatSeq(arr(joint.trn_locked).map(boolText)))
    editor.replace(formatSeq(arr(joint.initial_angles_deg)))
    editor.replace(formatSeq(arr(joint.initial_ang_rates_deg_s)))
    editor.replace(formatSeq(arr(joint.initial_displacements_m)))
    editor.replace(formatSeq(arr(joint.initial_displacement_rates_m_s)))
    editor.replace(formatSeq(arr(joint.bi_to_gi_static_angles_deg_seq)))
    editor.replace(formatSeq(arr(joint.go_to_bo_static_angles_deg_seq)))
    editor.replace(formatSeq(arr(joint.position_wrt_inner_body_origin_m)))
    editor.replace(formatSeq(arr(joint.position_wrt_outer_body_origin_m)))
    editor.replace(joint.parm_file)
  }
  writeSpacecraftCollections(editor, sc)
  await writeConfigFile(configDir, file, editor.text())
}

async function writeConfig(configDir: string, payload: unknown) {
  if (!isRecord(payload)) throw new Error("payload must be an object")
  await writeSim(configDir, rec(payload.sim))
  await Promise.all(arr(payload.orbits).map(item => writeOrbit(configDir, rec(item))))
  await Promise.all(arr(payload.spacecraft).map(item => writeSpacecraft(configDir, rec(item))))
  return await parseConfig(configDir)
}

async function loadGncConfig(req: { query: WorkspaceQuery }, reply: FastifyReply) {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const inputsDir = await getInputsDir(workspaceDir)
      const payload = await parseConfig(inputsDir)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        payload,
        source_dir: inputsDir,
        workspace_dir: workspaceDir,
      })
    } catch (err) {
      if (err instanceof Error) {
        return reply.status(500).send({ error: err.message })
      }
      return replyWithWorkspaceQueryError(reply, err, "failed to load GNC config")
    }
}

async function saveGncConfig(req: { body?: SaveBody }, reply: FastifyReply) {
    try {
      if (!req.body || typeof req.body !== "object" || !("payload" in req.body)) {
        return reply.status(400).send({ error: "payload is required" })
      }
      const workspaceDir = await resolveQueryWorkspaceDir(req.body)
      const inputsDir = await getInputsDir(workspaceDir)
      const payload = await writeConfig(inputsDir, req.body.payload)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        payload,
        source_dir: inputsDir,
        workspace_dir: workspaceDir,
      })
    } catch (err) {
      return reply.status(500).send({ error: getErrorMessage(err, "failed to save GNC config") })
    }
}

export async function gncConfigRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: WorkspaceQuery }>("/api/gnc-config", loadGncConfig)
  fastify.get<{ Querystring: WorkspaceQuery }>("/api/gnc/gnc-config", loadGncConfig)
  fastify.put<{ Body: SaveBody }>("/api/gnc-config", saveGncConfig)
  fastify.put<{ Body: SaveBody }>("/api/gnc/gnc-config", saveGncConfig)
}

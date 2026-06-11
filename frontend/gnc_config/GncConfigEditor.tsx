import { useCallback, useEffect, useMemo, useState } from "react"
import { joinApiPath } from "../src/app/apiBase"
import type { WorkspaceVersionContext } from "../src/pages/workspace/workspaceVersion"
import "./gnc_config.css"

type GncPayload = {
  sim?: Record<string, unknown>
  orbits?: Array<Record<string, unknown>>
  spacecraft?: Array<Record<string, unknown>>
  resolution?: Record<string, unknown>
}

type GncConfigEditorProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
}

const TIME_MODES = ["FAST", "REAL", "EXTERNAL", "NOS3"]
const CELESTIAL_BODY_FIELDS = [
  ["mercury", "Mercury"],
  ["venus", "Venus"],
  ["earth_luna", "Earth and Luna"],
  ["mars", "Mars and Moons"],
  ["jupiter", "Jupiter and Moons"],
  ["saturn", "Saturn and Moons"],
  ["uranus", "Uranus and Moons"],
  ["neptune", "Neptune and Moons"],
  ["pluto", "Pluto and Moons"],
  ["minor_bodies", "Asteroids and Comets"],
] as const
const LAGRANGE_SYSTEM_FIELDS = [
  ["earth_moon", "Earth-Moon"],
  ["sun_earth", "Sun-Earth"],
  ["sun_jupiter", "Sun-Jupiter"],
] as const
const WORLD_OPTIONS = [
  "SOL", "MERCURY", "VENUS", "EARTH", "LUNA", "MARS", "JUPITER",
  "SATURN", "URANUS", "NEPTUNE", "PLUTO", "MINORBODY_0", "MINORBODY_1", "MINORBODY_2",
]
const COLLECTIONS = [
  ["bodies", "Bodies"],
  ["joints", "Joints"],
  ["wheels", "Reaction Wheels"],
  ["mtbs", "MTBs"],
  ["thrusters", "Thrusters"],
  ["gyros", "Gyros"],
  ["magnetometers", "Magnetometers"],
  ["css", "CSS"],
  ["fss", "FSS"],
  ["star_trackers", "Star Trackers"],
  ["gps", "GPS"],
  ["accelerometers", "Accelerometers"],
  ["fgs", "FGS"],
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function getPath(root: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (Array.isArray(current) && typeof key === "number") return current[key]
    if (isRecord(current)) return current[key]
    return undefined
  }, root)
}

function setPath(root: unknown, path: Array<string | number>, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const copy = [...root]
    if (typeof head === "number") copy[head] = setPath(copy[head], rest, value)
    return copy
  }
  const base = isRecord(root) ? root : {}
  return {
    ...base,
    [head]: setPath(base[head], rest, value),
  }
}

function buildWorkspaceQuery(activeContext: WorkspaceVersionContext) {
  const workspaceDir = activeContext.versionDir ?? activeContext.sourceWorkspaceDir ?? activeContext.workspaceItem?.path
  const params = new URLSearchParams()
  if (workspaceDir) params.set("workspaceDir", workspaceDir)
  if (activeContext.workspaceId) params.set("workspaceId", activeContext.workspaceId)
  if (activeContext.versionId) params.set("versionId", activeContext.versionId)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === undefined || value === null) return ""
  return JSON.stringify(value)
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text()
  let data: unknown = null
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) throw new Error(text.trim())
      throw new Error(fallbackMessage)
    }
  }
  if (!response.ok) {
    const error = isRecord(data) && typeof data.error === "string" ? data.error : fallbackMessage
    throw new Error(error)
  }
  return data as T
}

function parseNumber(value: string, integer = false) {
  return integer ? Number.parseInt(value || "0", 10) : Number(value || 0)
}

function Field({
  integer = false,
  label,
  onChange,
  options,
  path,
  payload,
  type = "text",
}: {
  integer?: boolean
  label: string
  onChange: (path: Array<string | number>, value: unknown) => void
  options?: string[]
  path: Array<string | number>
  payload: GncPayload
  type?: "text" | "number" | "select" | "boolean"
}) {
  const value = getPath(payload, path)
  if (type === "boolean") {
    return (
      <label className="gnc-editor-toggle">
        <span>{label}</span>
        <input
          checked={value === true}
          onChange={event => onChange(path, event.target.checked)}
          type="checkbox"
        />
      </label>
    )
  }
  return (
    <label className="gnc-editor-field">
      <span>{label}</span>
      {type === "select" ? (
        <select value={formatValue(value)} onChange={event => onChange(path, event.target.value)}>
          {(options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          step={type === "number" && !integer ? "any" : undefined}
          type={type}
          value={formatValue(value)}
          onChange={event => onChange(path, type === "number" ? parseNumber(event.target.value, integer) : event.target.value)}
        />
      )}
    </label>
  )
}

function VectorField({
  integerLast = false,
  label,
  labels = ["X", "Y", "Z"],
  onChange,
  path,
  payload,
}: {
  integerLast?: boolean
  label: string
  labels?: string[]
  onChange: (path: Array<string | number>, value: unknown) => void
  path: Array<string | number>
  payload: GncPayload
}) {
  const values = asArray(getPath(payload, path))
  return (
    <div className="gnc-editor-field wide">
      <span>{label}</span>
      <div className="gnc-vector-grid">
        {values.map((value, index) => (
          <label key={index}>
            <span>{labels[index] ?? String(index)}</span>
            <input
              step={integerLast && index === values.length - 1 ? undefined : "any"}
              type="number"
              value={formatValue(value)}
              onChange={event => onChange([...path, index], parseNumber(event.target.value, integerLast && index === values.length - 1))}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function EditorCard({ children, subtitle, title }: { children: React.ReactNode; subtitle: string; title: string }) {
  return (
    <section className="gnc-editor-card">
      <div className="gnc-editor-card-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

export function GncConfigEditor({ activeContext, apiBase }: GncConfigEditorProps) {
  const [payload, setPayload] = useState<GncPayload | null>(null)
  const [sourceDir, setSourceDir] = useState("")
  const [status, setStatus] = useState("准备读取配置")
  const [selectedOrbit, setSelectedOrbit] = useState(0)
  const [selectedSpacecraft, setSelectedSpacecraft] = useState(0)
  const [collection, setCollection] = useState<(typeof COLLECTIONS)[number][0]>("bodies")
  const [collectionIndex, setCollectionIndex] = useState(0)
  const workspaceQuery = useMemo(() => buildWorkspaceQuery(activeContext), [activeContext])
  const endpoint = useMemo(() => joinApiPath(apiBase, "/gnc-config"), [apiBase])

  const update = useCallback((path: Array<string | number>, value: unknown) => {
    setPayload(current => setPath(current ?? {}, path, value) as GncPayload)
  }, [])

  const loadConfig = useCallback(async () => {
    setStatus("正在读取 workspaceDir/00_inputs")
    const response = await fetch(`${endpoint}${workspaceQuery}`, { cache: "no-store" })
    const data = await readJsonResponse<{ payload?: GncPayload; source_dir?: string }>(response, "读取 GNC 配置失败")
    setPayload(data.payload ?? {})
    setSourceDir(data.source_dir ?? "")
    setSelectedOrbit(0)
    setSelectedSpacecraft(0)
    setCollectionIndex(0)
    setStatus("配置已加载")
  }, [endpoint, workspaceQuery])

  useEffect(() => {
    loadConfig().catch(error => {
      setPayload(null)
      setStatus(error instanceof Error ? error.message : "读取 GNC 配置失败")
    })
  }, [loadConfig])

  const saveConfig = async () => {
    if (!payload) return
    setStatus("正在写回配置文件")
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        payload,
        workspaceDir: activeContext.versionDir ?? activeContext.sourceWorkspaceDir ?? activeContext.workspaceItem?.path,
        workspaceId: activeContext.workspaceId,
        versionId: activeContext.versionId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    })
    const data = await readJsonResponse<{ payload?: GncPayload; source_dir?: string }>(response, "保存 GNC 配置失败")
    setPayload(data.payload ?? payload)
    setSourceDir(data.source_dir ?? sourceDir)
    setStatus("配置文件已保存")
  }

  const orbit = asRecord(payload?.orbits?.[selectedOrbit])
  const spacecraft = asRecord(payload?.spacecraft?.[selectedSpacecraft])
  const collectionBlock = collection === "bodies" || collection === "joints"
    ? asArray(spacecraft[collection])
    : asArray(asRecord(spacecraft[collection]).items)
  const activeCollectionItem = asRecord(collectionBlock[collectionIndex])
  const collectionBasePath = collection === "bodies" || collection === "joints"
    ? ["spacecraft", selectedSpacecraft, collection, collectionIndex]
    : ["spacecraft", selectedSpacecraft, collection, "items", collectionIndex]

  if (!payload) {
    return (
      <div className="gnc-editor-shell">
        <div className="gnc-editor-empty">{status}</div>
      </div>
    )
  }

  return (
    <div className="gnc-editor-shell">
      <div className="gnc-editor-top">
        <div>
          <span>42 CONFIG STUDIO</span>
          <small>{sourceDir || "workspaceDir/00_inputs"}</small>
        </div>
        <div className="gnc-editor-actions">
          <button type="button" onClick={() => loadConfig().catch(error => setStatus(error instanceof Error ? error.message : "读取失败"))}>Reload</button>
          <button type="button" className="primary" onClick={() => saveConfig().catch(error => setStatus(error instanceof Error ? error.message : "保存失败"))}>Save</button>
        </div>
      </div>
      <div className="gnc-editor-status">{status}</div>

      <div className="gnc-editor-grid">
        <EditorCard title="Simulation Control" subtitle="Top-level values from Inp_Sim.txt">
          <div className="gnc-form-grid">
            <Field label="Time Mode" onChange={update} options={TIME_MODES} path={["sim", "time_mode"]} payload={payload} type="select" />
            <Field label="Stop Time (s)" onChange={update} path={["sim", "stop_time_s"]} payload={payload} type="number" />
            <Field label="Step Size (s)" onChange={update} path={["sim", "dt_sim_s"]} payload={payload} type="number" />
            <Field label="Output Interval (s)" onChange={update} path={["sim", "dTout_s"]} payload={payload} type="number" />
            <Field integer label="RNG Seed" onChange={update} path={["sim", "rng_seed"]} payload={payload} type="number" />
            <Field label="Enable Graphics" onChange={update} path={["sim", "gl_enable"]} payload={payload} type="boolean" />
            <Field label="Command File" onChange={update} path={["sim", "cmd_file"]} payload={payload} />
            <Field integer label="UTC Month" onChange={update} path={["sim", "utc_date", "month"]} payload={payload} type="number" />
            <Field integer label="UTC Day" onChange={update} path={["sim", "utc_date", "day"]} payload={payload} type="number" />
            <Field integer label="UTC Year" onChange={update} path={["sim", "utc_date", "year"]} payload={payload} type="number" />
            <Field integer label="UTC Hour" onChange={update} path={["sim", "utc_time", "hour"]} payload={payload} type="number" />
            <Field integer label="UTC Minute" onChange={update} path={["sim", "utc_time", "minute"]} payload={payload} type="number" />
            <Field label="UTC Second" onChange={update} path={["sim", "utc_time", "second"]} payload={payload} type="number" />
            <Field label="Leap Seconds" onChange={update} path={["sim", "leap_seconds"]} payload={payload} type="number" />
            <Field label="Atmosphere Option" onChange={update} options={["USER", "NOMINAL", "TWOSIGMA"]} path={["sim", "atmo_option"]} payload={payload} type="select" />
            <Field label="Flux10p7" onChange={update} path={["sim", "flux10p7"]} payload={payload} type="number" />
            <Field label="Geomag Index" onChange={update} path={["sim", "geomag_index"]} payload={payload} type="number" />
            <Field label="Mag Model" onChange={update} options={["NONE", "DIPOLE", "IGRF"]} path={["sim", "mag_model", "type"]} payload={payload} type="select" />
            <Field integer label="IGRF Degree" onChange={update} path={["sim", "mag_model", "n"]} payload={payload} type="number" />
            <Field integer label="IGRF Order" onChange={update} path={["sim", "mag_model", "m"]} payload={payload} type="number" />
            <Field integer label="Earth Gravity N" onChange={update} path={["sim", "earth_gravity_model", "n"]} payload={payload} type="number" />
            <Field integer label="Earth Gravity M" onChange={update} path={["sim", "earth_gravity_model", "m"]} payload={payload} type="number" />
            <Field integer label="Mars Gravity N" onChange={update} path={["sim", "mars_gravity_model", "n"]} payload={payload} type="number" />
            <Field integer label="Mars Gravity M" onChange={update} path={["sim", "mars_gravity_model", "m"]} payload={payload} type="number" />
            <Field integer label="Luna Gravity N" onChange={update} path={["sim", "luna_gravity_model", "n"]} payload={payload} type="number" />
            <Field integer label="Luna Gravity M" onChange={update} path={["sim", "luna_gravity_model", "m"]} payload={payload} type="number" />
            <Field label="Ephemeris Option" onChange={update} options={["MEAN", "DE430", "DE440"]} path={["sim", "ephem_option"]} payload={payload} type="select" />
          </div>
          <div className="gnc-toggle-grid">
            {[
              "aero_active", "aero_shadows_active", "gg_active", "sol_press_active",
              "sol_press_shadows_active", "residual_dipole_active", "grav_pert_active",
              "thruster_plumes_active", "contact_active", "slosh_active", "albedo_active", "compute_env_trq",
            ].map(key => (
              <Field key={key} label={key} onChange={update} path={["sim", key]} payload={payload} type="boolean" />
            ))}
          </div>
        </EditorCard>

        <EditorCard title="Celestial Bodies" subtitle="Celestial Bodies and Lagrange systems from Inp_Sim.txt">
          <div className="gnc-toggle-grid compact">
            {CELESTIAL_BODY_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} onChange={update} path={["sim", "celestial_bodies", key]} payload={payload} type="boolean" />
            ))}
          </div>
          <div className="gnc-editor-subhead">Lagrange Point Systems</div>
          <div className="gnc-toggle-grid compact">
            {LAGRANGE_SYSTEM_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} onChange={update} path={["sim", "lagrange_systems", key]} payload={payload} type="boolean" />
            ))}
          </div>
        </EditorCard>

        <EditorCard title="Orbit Configuration" subtitle={formatValue(orbit.file) || "Referenced orbit"}>
          <div className="gnc-form-grid">
            <label className="gnc-editor-field wide">
              <span>Active Orbit</span>
              <select value={selectedOrbit} onChange={event => setSelectedOrbit(Number(event.target.value))}>
                {(payload.orbits ?? []).map((item, index) => <option key={index} value={index}>Orb[{index}] {formatValue(item.file)}</option>)}
              </select>
            </label>
            <Field label="Description" onChange={update} path={["orbits", selectedOrbit, "description"]} payload={payload} />
            <Field label="Regime" onChange={update} options={["ZERO", "FLIGHT", "CENTRAL", "THREE_BODY"]} path={["orbits", selectedOrbit, "regime"]} payload={payload} type="select" />
            <Field label="CENTRAL.World" onChange={update} options={WORLD_OPTIONS} path={["orbits", selectedOrbit, "central", "world"]} payload={payload} type="select" />
            <Field label="CENTRAL.InputType" onChange={update} options={["KEP", "RV", "FILE"]} path={["orbits", selectedOrbit, "central", "input_type"]} payload={payload} type="select" />
            <Field label="Inclination (deg)" onChange={update} path={["orbits", selectedOrbit, "central", "kep", "inclination_deg"]} payload={payload} type="number" />
            <Field label="RAAN (deg)" onChange={update} path={["orbits", selectedOrbit, "central", "kep", "raan_deg"]} payload={payload} type="number" />
            <Field label="True Anomaly (deg)" onChange={update} path={["orbits", selectedOrbit, "central", "kep", "true_anomaly_deg"]} payload={payload} type="number" />
            <VectorField label="RV Position (km)" onChange={update} path={["orbits", selectedOrbit, "central", "rv", "position_km"]} payload={payload} />
            <VectorField label="RV Velocity (km/s)" onChange={update} path={["orbits", selectedOrbit, "central", "rv", "velocity_km_s"]} payload={payload} />
          </div>
        </EditorCard>

        <EditorCard title="Spacecraft Core" subtitle={formatValue(spacecraft.file) || "Referenced spacecraft"}>
          <div className="gnc-form-grid">
            <label className="gnc-editor-field wide">
              <span>Active Spacecraft</span>
              <select value={selectedSpacecraft} onChange={event => setSelectedSpacecraft(Number(event.target.value))}>
                {(payload.spacecraft ?? []).map((item, index) => <option key={index} value={index}>SC[{index}] {formatValue(item.file)}</option>)}
              </select>
            </label>
            <Field label="Description" onChange={update} path={["spacecraft", selectedSpacecraft, "description"]} payload={payload} />
            <Field label="Label" onChange={update} path={["spacecraft", selectedSpacecraft, "label"]} payload={payload} />
            <Field label="FSW Tag" onChange={update} path={["spacecraft", selectedSpacecraft, "fsw_tag"]} payload={payload} />
            <Field label="FSW Sample Time (s)" onChange={update} path={["spacecraft", selectedSpacecraft, "fsw_sample_time_s"]} payload={payload} type="number" />
            <Field label="OrbDOF" onChange={update} options={["FIXED", "EULER_HILL", "ENCKE", "COWELL"]} path={["spacecraft", selectedSpacecraft, "orbit_parameters", "orb_dof"]} payload={payload} type="select" />
            <VectorField label="Angular Rate (deg/s)" onChange={update} path={["spacecraft", selectedSpacecraft, "initial_attitude", "angular_rate_deg_s"]} payload={payload} />
            <VectorField label="Quaternion" labels={["q0", "q1", "q2", "q3"]} onChange={update} path={["spacecraft", selectedSpacecraft, "initial_attitude", "quaternion"]} payload={payload} />
            <VectorField integerLast label="Euler Angles" labels={["A1", "A2", "A3", "Seq"]} onChange={update} path={["spacecraft", selectedSpacecraft, "initial_attitude", "euler_angles_deg_seq"]} payload={payload} />
          </div>
        </EditorCard>

        <EditorCard title="Actuators, Sensors, Bodies" subtitle="Use selectors to switch multi-instance entries.">
          <div className="gnc-editor-toolbar">
            <select value={collection} onChange={event => { setCollection(event.target.value as typeof collection); setCollectionIndex(0) }}>
              {COLLECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={collectionIndex} onChange={event => setCollectionIndex(Number(event.target.value))} disabled={collectionBlock.length === 0}>
              {collectionBlock.length === 0 ? <option>No items</option> : collectionBlock.map((_item, index) => <option key={index} value={index}>{collection} [{index}]</option>)}
            </select>
          </div>
          {collectionBlock.length === 0 ? (
            <div className="gnc-editor-empty small">No {collection} configured</div>
          ) : (
            <div className="gnc-form-grid">
              {Object.entries(activeCollectionItem).filter(([key]) => key !== "index").map(([key, value]) => (
                Array.isArray(value) ? (
                  <VectorField key={key} label={key} onChange={update} path={[...collectionBasePath, key]} payload={payload} />
                ) : typeof value === "boolean" ? (
                  <Field key={key} label={key} onChange={update} path={[...collectionBasePath, key]} payload={payload} type="boolean" />
                ) : typeof value === "number" ? (
                  <Field key={key} label={key} onChange={update} path={[...collectionBasePath, key]} payload={payload} type="number" />
                ) : (
                  <Field key={key} label={key} onChange={update} path={[...collectionBasePath, key]} payload={payload} />
                )
              ))}
            </div>
          )}
        </EditorCard>
      </div>

      <section className="gnc-editor-preview">
        <div>
          <span>PAYLOAD PREVIEW</span>
          <strong>Editable JSON For Backend</strong>
        </div>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </section>
    </div>
  )
}

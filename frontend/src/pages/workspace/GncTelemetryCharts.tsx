import * as d3 from "d3"

export type TelemetryRow = Record<string, number | string>

export type Gnc42TelemetryTexts = {
  hwhl: string
  mtb: string
  posn: string
  qbn: string
  time: string
  veln: string
  wbn: string
}

type SeriesPoint = {
  t: number
  y: number
}

type LineSeries = {
  color: string
  label: string
  points: SeriesPoint[]
}

type ModeSegment = {
  end: number
  id: number
  mode: string
  start: number
}

const DEG = 180 / Math.PI
const PALETTE = ["#17e7ff", "#8ee6a5", "#ffd166", "#ff8fb3"]
export const DEFAULT_WHEEL_INERTIA = 0.00068209

export function parseTelemetryCsv(text: string, maxRows = 2400) {
  const rows = d3.csvParse(text)
  const step = Math.max(1, Math.ceil(rows.length / maxRows))
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1).map(row => {
    const parsed: TelemetryRow = {}
    for (const [key, value] of Object.entries(row)) {
      const numeric = Number(value)
      parsed[key] = value !== "" && Number.isFinite(numeric) ? numeric : value ?? ""
    }
    return parsed
  })
}

function parseNumericTable(text: string) {
  return text.split(/\r?\n/u).flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed) return []
    const values = trimmed.split(/\s+/u).map(value => Number(value))
    return values.every(Number.isFinite) ? [values] : []
  })
}

function sampleIndexes(length: number, maxRows = 2400) {
  const step = Math.max(1, Math.ceil(length / maxRows))
  const indexes: number[] = []
  for (let index = 0; index < length; index += step) indexes.push(index)
  if (length > 0 && indexes[indexes.length - 1] !== length - 1) indexes.push(length - 1)
  return indexes
}

function valueAt(table: number[][], rowIndex: number, columnIndex: number) {
  const value = table[rowIndex]?.[columnIndex]
  return Number.isFinite(value) ? value : null
}

export function parseGnc42Telemetry(texts: Gnc42TelemetryTexts, maxRows = 2400) {
  const time = parseNumericTable(texts.time).map(row => row[0]).filter(Number.isFinite)
  const wbn = parseNumericTable(texts.wbn)
  const qbn = parseNumericTable(texts.qbn)
  const posn = parseNumericTable(texts.posn)
  const veln = parseNumericTable(texts.veln)
  const hwhl = parseNumericTable(texts.hwhl)
  const mtb = parseNumericTable(texts.mtb)
  const rowCount = Math.min(time.length, wbn.length, qbn.length, posn.length, veln.length)
  const scRows: TelemetryRow[] = sampleIndexes(rowCount, maxRows).flatMap(index => {
    const row: TelemetryRow = { Sc_Time: time[index] }
    const qKeys = ["Sc_qn_1", "Sc_qn_2", "Sc_qn_3", "Sc_qn_4"]
    const wKeys = ["Sc_wn_1", "Sc_wn_2", "Sc_wn_3"]
    const posKeys = ["Sc_PosN_1", "Sc_PosN_2", "Sc_PosN_3"]
    const velKeys = ["Sc_VelN_1", "Sc_VelN_2", "Sc_VelN_3"]
    for (const [column, key] of qKeys.entries()) {
      const value = valueAt(qbn, index, column)
      if (value === null) return []
      row[key] = value
    }
    for (const [column, key] of wKeys.entries()) {
      const value = valueAt(wbn, index, column)
      if (value === null) return []
      row[key] = value
    }
    for (const [column, key] of posKeys.entries()) {
      const value = valueAt(posn, index, column)
      if (value === null) return []
      row[key] = value
    }
    for (const [column, key] of velKeys.entries()) {
      const value = valueAt(veln, index, column)
      if (value === null) return []
      row[key] = value
    }
    return [row]
  })

  const wheelRowCount = Math.min(time.length, hwhl.length)
  const wheelRows: TelemetryRow[] = sampleIndexes(wheelRowCount, maxRows).flatMap(index => {
    const row: TelemetryRow = { AcWhl_Time: time[index] }
    for (let column = 0; column < Math.min(4, hwhl[index]?.length ?? 0); column += 1) {
      const value = valueAt(hwhl, index, column)
      if (value === null) return []
      row[`Ac_Whl${column}_H`] = value
    }
    return [row]
  })

  const mtbRowCount = Math.min(time.length, mtb.length)
  const mtbRows: TelemetryRow[] = sampleIndexes(mtbRowCount, maxRows).flatMap(index => {
    const row: TelemetryRow = { Mtb_Time: time[index] }
    const keys = ["Mtb_X", "Mtb_Y", "Mtb_Z"]
    for (const [column, key] of keys.entries()) {
      const value = valueAt(mtb, index, column)
      if (value === null) return []
      row[key] = value
    }
    return [row]
  })

  return {
    finalTime: time.length > 0 ? time[time.length - 1] : 0,
    mtbRows,
    scRows,
    wheelRows,
  }
}

type RunSummaryTransition = {
  mode?: unknown
  mode_id?: unknown
  modeId?: unknown
  time_s?: unknown
  timeSec?: unknown
}

export function modeRowsFromRunSummary(text: string, finalTime = 0): TelemetryRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== "object") return []
  const summary = parsed as { mode_result?: { transitions?: RunSummaryTransition[] } }
  const transitions = Array.isArray(summary.mode_result?.transitions) ? summary.mode_result.transitions : []
  const rows = transitions.flatMap((transition, index) => {
    const timeValue = typeof transition.time_s === "number" ? transition.time_s : Number(transition.time_s ?? transition.timeSec)
    if (!Number.isFinite(timeValue)) return []
    return [{
      Mode: typeof transition.mode === "string" ? transition.mode : `Mode ${index}`,
      ModeId: typeof transition.mode_id === "number" ? transition.mode_id : typeof transition.modeId === "number" ? transition.modeId : index,
      TimeSec: timeValue,
    }]
  })
  if (rows.length > 0 && finalTime > Number(rows[rows.length - 1].TimeSec)) {
    rows.push({ ...rows[rows.length - 1], TimeSec: finalTime })
  }
  return rows
}

function num(row: TelemetryRow, key: string) {
  const value = row[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function str(row: TelemetryRow, key: string) {
  const value = row[key]
  return typeof value === "string" ? value : String(value ?? "")
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "N/A"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} hr ${minutes} min`
}

function formatTimeStep(rows: TelemetryRow[]) {
  if (rows.length < 2) return "N/A"
  const first = num(rows[0], "Sc_Time")
  const second = num(rows[1], "Sc_Time")
  if (first === null || second === null) return "N/A"
  const step = second - first
  return Number.isFinite(step) && step > 0 ? `${step.toFixed(step >= 1 ? 1 : 2)} s` : "N/A"
}

function latestMode(modeRows: TelemetryRow[]) {
  const mode = modeRows.length > 0 ? str(modeRows[modeRows.length - 1], "Mode") : ""
  return mode || "Earth-Pointing (Nominal)"
}

function nextMode(_modeRows: TelemetryRow[]) {
  return "N/A"
}

function finalTime(rows: TelemetryRow[]) {
  const value = rows.length > 0 ? num(rows[rows.length - 1], "Sc_Time") : null
  return value ?? 0
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="gnc-summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function GncDashboardSummary({
  modeRows,
  scRows,
}: {
  modeRows: TelemetryRow[]
  scRows: TelemetryRow[]
}) {
  const duration = finalTime(scRows)
  const activeMode = latestMode(modeRows)
  const transition = nextMode(modeRows)
  return (
    <section className="gnc-summary-strip" aria-label="GNC overview">
      <article className="gnc-summary-card">
        <header>
          <h3>MISSION SUMMARY</h3>
          <span>i</span>
        </header>
        <SummaryRow label="Scenario" value="Earth-Pointing (Nominal)" />
        <SummaryRow label="Duration" value={formatDuration(duration)} />
        <SummaryRow label="Time Step" value={formatTimeStep(scRows)} />
        <SummaryRow label="Environment" value="LEO, 600 km, 30 deg inc" />
        <SummaryRow label="Start Time (UTC)" value="2016-03-21 12:00:00" />
        <SummaryRow label="Status" value={duration > 0 ? "Completed" : "N/A"} />
      </article>

      <article className="gnc-summary-card">
        <header>
          <h3>CONTROLLER SUMMARY</h3>
          <span>i</span>
        </header>
        <SummaryRow label="Primary Controller" value="Earth-Pointing Controller" />
        <SummaryRow label="Control Law" value="LQR + Feedforward" />
        <SummaryRow label="Bandwidth (BW)" value="0.015 rad/s" />
        <SummaryRow label="Sensor Suite" value="Star Tracker + Gyro + Sun Sensor" />
        <SummaryRow label="Actuators" value="RW (4) + MTQ (3)" />
        <div className="gnc-summary-limit">
          <SummaryRow label="Bias Momentum Limit" value="80 Nms" />
          <div className="gnc-summary-meter"><span style={{ width: "62%" }} /></div>
        </div>
        <div className="gnc-summary-limit">
          <SummaryRow label="RW Speed Limit" value="6000 RPM" />
          <div className="gnc-summary-meter"><span style={{ width: "71%" }} /></div>
        </div>
      </article>

      <article className="gnc-summary-card gnc-architecture-card">
        <header>
          <h3>MODE & ARCHITECTURE</h3>
          <span>i</span>
        </header>
        <SummaryRow label="Active Mode" value={activeMode} />
        <SummaryRow label="Next Mode Transition" value={transition} />
        <SummaryRow label="Architecture" value="Bias Momentum" />
        <div className="gnc-architecture">
          <div className="gnc-architecture-block is-sensor">
            <b>Sensors</b>
            <span>Star Tracker</span>
            <span>Gyro</span>
            <span>Sun Sensor</span>
            <span>Magnetometer</span>
          </div>
          <div className="gnc-architecture-flow" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="gnc-architecture-block is-computer">
            <b>GNC Computer</b>
            <span>EPC Controller</span>
            <span>Mode Logic</span>
            <span>State Estimator</span>
          </div>
          <div className="gnc-architecture-flow is-command" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="gnc-architecture-block is-actuator">
            <b>Actuators</b>
            <span>RW (4)</span>
            <span>MTQ (3)</span>
            <span>Thrusters</span>
          </div>
        </div>
        <div className="gnc-architecture-legend">
          <span><i className="is-measurement" />Measurements</span>
          <span><i className="is-command" />Commands</span>
        </div>
      </article>
    </section>
  )
}

function seriesFrom(rows: TelemetryRow[], timeKey: string, specs: Array<{ key: string; label: string; scale?: number }>): LineSeries[] {
  return specs.map((spec, index) => ({
    color: PALETTE[index % PALETTE.length] ?? "#17e7ff",
    label: spec.label,
    points: rows.flatMap(row => {
      const t = num(row, timeKey)
      const y = num(row, spec.key)
      return t === null || y === null ? [] : [{ t, y: y * (spec.scale ?? 1) }]
    }),
  })).filter(item => item.points.length > 0)
}

function vector(row: TelemetryRow, keys: [string, string, string]) {
  const values = keys.map(key => num(row, key))
  return values.every((value): value is number => value !== null) ? values as [number, number, number] : null
}

function norm(value: [number, number, number]) {
  return Math.hypot(value[0], value[1], value[2])
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function scaleVec(value: [number, number, number], factor: number): [number, number, number] {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function normalize(value: [number, number, number]) {
  const length = norm(value)
  return length > 0 ? scaleVec(value, 1 / length) : null
}

function transpose(matrix: number[][]) {
  return matrix[0].map((_, column) => matrix.map(row => row[column]))
}

function multiply(a: number[][], b: number[][]) {
  return a.map(row => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)))
}

function q2c(q: [number, number, number, number]) {
  const [q1, q2, q3, qs] = q
  return [
    [1 - 2 * (q2 * q2 + q3 * q3), 2 * (q1 * q2 + qs * q3), 2 * (q1 * q3 - qs * q2)],
    [2 * (q1 * q2 - qs * q3), 1 - 2 * (q1 * q1 + q3 * q3), 2 * (q2 * q3 + qs * q1)],
    [2 * (q1 * q3 + qs * q2), 2 * (q2 * q3 - qs * q1), 1 - 2 * (q1 * q1 + q2 * q2)],
  ]
}

function c2a123(c: number[][]): [number, number, number] {
  const th1 = Math.atan2(-c[2][1], c[2][2])
  const th2 = Math.asin(Math.max(-1, Math.min(1, c[2][0])))
  const th3 = Math.atan2(-c[1][0], c[0][0])
  return [th1 * DEG, th2 * DEG, th3 * DEG]
}

function findCln(r: [number, number, number], v: [number, number, number]) {
  const h = cross(r, v)
  const rr = norm(r)
  const hh = norm(h)
  if (rr <= 0 || hh <= 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const l3 = scaleVec(r, -1 / rr)
  const l2 = scaleVec(h, -1 / hh)
  const l1 = normalize(cross(l2, l3)) ?? [1, 0, 0]
  return [l1, l2, l3]
}

function derivedEulerSeries(rows: TelemetryRow[], kind: "inertial" | "orbit") {
  const roll: SeriesPoint[] = []
  const pitch: SeriesPoint[] = []
  const yaw: SeriesPoint[] = []
  for (const row of rows) {
    const t = num(row, "Sc_Time")
    const qValues = ["Sc_qn_1", "Sc_qn_2", "Sc_qn_3", "Sc_qn_4"].map(key => num(row, key))
    if (t === null || !qValues.every((value): value is number => value !== null)) continue
    const cbn = q2c(qValues as [number, number, number, number])
    let attitudeMatrix = cbn
    if (kind === "orbit") {
      const posn = vector(row, ["Sc_PosN_1", "Sc_PosN_2", "Sc_PosN_3"])
      const veln = vector(row, ["Sc_VelN_1", "Sc_VelN_2", "Sc_VelN_3"])
      if (!posn || !veln) continue
      attitudeMatrix = multiply(cbn, transpose(findCln(posn, veln)))
    }
    const euler = c2a123(attitudeMatrix)
    roll.push({ t, y: euler[0] })
    pitch.push({ t, y: euler[1] })
    yaw.push({ t, y: euler[2] })
  }
  return [
    { color: PALETTE[0], label: "roll", points: roll },
    { color: PALETTE[1], label: "pitch", points: pitch },
    { color: PALETTE[2], label: "yaw", points: yaw },
  ]
}

function reactionWheelRpmSeries(rows: TelemetryRow[]) {
  return ["Ac_Whl0_H", "Ac_Whl1_H", "Ac_Whl2_H", "Ac_Whl3_H"].map((key, index) => ({
    color: PALETTE[index % PALETTE.length] ?? "#17e7ff",
    label: `wheel${index}`,
    points: rows.flatMap(row => {
      const t = num(row, "AcWhl_Time")
      const h = num(row, key)
      return t === null || h === null ? [] : [{ t, y: h / DEFAULT_WHEEL_INERTIA * 60 / (2 * Math.PI) }]
    }),
  })).filter(item => item.points.length > 0)
}

function diagnosticSeries(rows: TelemetryRow[]) {
  const rateMag: SeriesPoint[] = []
  const sunError: SeriesPoint[] = []
  for (const row of rows) {
    const t = num(row, "Sc_Time")
    const w = vector(row, ["Sc_wn_1", "Sc_wn_2", "Sc_wn_3"])
    const qValues = ["Sc_qn_1", "Sc_qn_2", "Sc_qn_3", "Sc_qn_4"].map(key => num(row, key))
    if (t === null || !w || !qValues.every((value): value is number => value !== null)) continue
    rateMag.push({ t, y: norm(w) * DEG })
    const cbn = q2c(qValues as [number, number, number, number])
    const sunB = [cbn[0][0], cbn[1][0], cbn[2][0]]
    const sunLength = Math.hypot(sunB[0], sunB[1], sunB[2])
    if (sunLength <= 0) continue
    const bodyYDotSun = Math.max(-1, Math.min(1, sunB[1] / sunLength))
    sunError.push({ t, y: Math.acos(bodyYDotSun) * DEG })
  }
  return [
    { color: PALETTE[0], label: "rate |w|", points: rateMag },
    { color: PALETTE[2], label: "sun error", points: sunError },
  ].filter(item => item.points.length > 0)
}

function mtbCommandSeries(rows: TelemetryRow[]) {
  return seriesFrom(rows, "Mtb_Time", [
    { key: "Mtb_X", label: "mx" },
    { key: "Mtb_Y", label: "my" },
    { key: "Mtb_Z", label: "mz" },
  ])
}

function niceLimits(series: LineSeries[]): [number, number] {
  const finite = series.flatMap(item => item.points.map(point => point.y)).filter(value => Number.isFinite(value))
  let vmax = finite.length > 0 ? Math.max(...finite.map(value => Math.abs(value))) : 1
  vmax = Math.max(vmax, 1e-6)
  let span: number
  if (vmax < 1) span = Math.ceil(vmax * 10) / 10
  else if (vmax < 10) span = Math.ceil(vmax)
  else if (vmax < 100) span = Math.ceil(vmax / 5) * 5
  else if (vmax < 1000) span = Math.ceil(vmax / 50) * 50
  else span = Math.ceil(vmax / 500) * 500
  return [-span, span]
}

function positiveLimits(series: LineSeries[], floor = 1) {
  const finite = series.flatMap(item => item.points.map(point => point.y)).filter(value => Number.isFinite(value))
  const vmax = finite.length > 0 ? Math.max(...finite, floor) : floor
  let top: number
  if (vmax < 1) top = Math.ceil(vmax * 10) / 10
  else if (vmax < 10) top = Math.ceil(vmax)
  else if (vmax < 100) top = Math.ceil(vmax / 5) * 5
  else top = Math.ceil(vmax / 50) * 50
  return [0, top] as [number, number]
}

function modeSegments(rows: TelemetryRow[]): ModeSegment[] {
  const segments: ModeSegment[] = []
  for (const row of rows) {
    const t = num(row, "TimeSec")
    const id = num(row, "ModeId")
    if (t === null || id === null) continue
    const mode = str(row, "Mode") || `Mode ${id}`
    const last = segments[segments.length - 1]
    if (!last || last.mode !== mode) {
      if (last) last.end = t
      segments.push({ end: t, id, mode, start: t })
    } else {
      last.end = t
    }
  }
  return segments.filter(segment => segment.end > segment.start)
}

function shortenLabel(value: string, maxLength = 12) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function ChartLegend({ compact = false, items, x, y }: { compact?: boolean; items: Array<{ color: string; label: string }>; x: number; y: number }) {
  return (
    <g className={`gnc-legend${compact ? " compact" : ""}`} transform={`translate(${x},${y})`}>
      <rect x="-8" y="-10" width={compact ? 106 : 100} height={items.length * 15 + 12} rx="6" />
      {items.map((item, index) => (
        <g key={item.label} transform={`translate(0,${index * 15})`}>
          <circle r="3.5" fill={item.color} />
          <text x="9" dy="0.32em">{compact ? shortenLabel(item.label, 11) : item.label}</text>
        </g>
      ))}
    </g>
  )
}

function LineChart({ series, title, unit }: { series: LineSeries[]; title: string; unit: string }) {
  const width = 760
  const height = 210
  const margin = { bottom: 36, left: 58, right: 18, top: 20 }
  const allPoints = series.flatMap(item => item.points)
  const xExtent = d3.extent(allPoints, point => point.t)
  const xDomain: [number, number] = [xExtent[0] ?? 0, xExtent[1] ?? 1]
  const yDomain = niceLimits(series)
  const x = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right])
  const y = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top])
  const line = d3.line<SeriesPoint>()
    .defined(point => Number.isFinite(point.t) && Number.isFinite(point.y))
    .x(point => x(point.t))
    .y(point => y(point.y))

  return (
    <figure className="gnc-dashboard-plot">
      <figcaption><strong>{title}</strong></figcaption>
      <svg className="gnc-d3-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <g className="gnc-grid">
          {y.ticks(5).map(tick => (
            <line key={`y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
          ))}
        </g>
        <g className="gnc-axis">
          <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
          {x.ticks(6).map(tick => (
            <g key={`x-${tick}`} transform={`translate(${x(tick)},${height - margin.bottom})`}>
              <line y2="5" />
              <text y="20">{d3.format(".2f")(tick / 3600)}h</text>
            </g>
          ))}
          {y.ticks(5).map(tick => (
            <g className="gnc-y-tick" key={`yt-${tick}`} transform={`translate(${margin.left},${y(tick)})`}>
              <line x2="-5" />
              <text x="-9" dy="0.32em">{d3.format(".3~g")(tick)}</text>
            </g>
          ))}
          <text className="gnc-axis-label" x={margin.left} y="12">{unit}</text>
        </g>
        {series.map(item => (
          <path key={item.label} d={line(item.points) ?? ""} fill="none" stroke={item.color} strokeWidth="2.2" />
        ))}
        <ChartLegend items={series} x={width - 112} y={34} />
      </svg>
    </figure>
  )
}

function DiagnosticChart({ series }: { series: LineSeries[] }) {
  const width = 760
  const height = 210
  const margin = { bottom: 36, left: 58, right: 18, top: 20 }
  const allPoints = series.flatMap(item => item.points)
  const xExtent = d3.extent(allPoints, point => point.t)
  const xDomain: [number, number] = [xExtent[0] ?? 0, xExtent[1] ?? 1]
  const yDomain = positiveLimits(series, 5)
  const x = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right])
  const y = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top])
  const line = d3.line<SeriesPoint>()
    .defined(point => Number.isFinite(point.t) && Number.isFinite(point.y))
    .x(point => x(point.t))
    .y(point => y(point.y))
  const thresholds = [
    { color: "#17e7ff", label: "0.1 deg/s", value: 0.1 },
    { color: "#17e7ff", label: "0.2 deg/s", value: 0.2 },
    { color: "#ffd166", label: "5 deg", value: 5 },
  ].filter(item => item.value >= yDomain[0] && item.value <= yDomain[1])

  return (
    <figure className="gnc-dashboard-plot">
      <figcaption><strong>太阳捕获诊断</strong></figcaption>
      <svg className="gnc-d3-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="太阳捕获诊断">
        <g className="gnc-grid">
          {y.ticks(5).map(tick => (
            <line key={`y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
          ))}
        </g>
        <g className="gnc-axis">
          <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
          {x.ticks(6).map(tick => (
            <g key={`x-${tick}`} transform={`translate(${x(tick)},${height - margin.bottom})`}>
              <line y2="5" />
              <text y="20">{d3.format(".2f")(tick / 3600)}h</text>
            </g>
          ))}
          {y.ticks(5).map(tick => (
            <g className="gnc-y-tick" key={`yt-${tick}`} transform={`translate(${margin.left},${y(tick)})`}>
              <line x2="-5" />
              <text x="-9" dy="0.32em">{d3.format(".3~g")(tick)}</text>
            </g>
          ))}
          <text className="gnc-axis-label" x={margin.left} y="12">deg/s, deg</text>
        </g>
        {thresholds.map(item => (
          <g key={item.label}>
            <line x1={margin.left} x2={width - margin.right} y1={y(item.value)} y2={y(item.value)} stroke={item.color} strokeDasharray="5 5" strokeOpacity="0.7" />
            <text x={width - 84} y={y(item.value) - 4} fill={item.color}>{item.label}</text>
          </g>
        ))}
        {series.map(item => (
          <path key={item.label} d={line(item.points) ?? ""} fill="none" stroke={item.color} strokeWidth="2.2" />
        ))}
        <ChartLegend items={series} x={width - 112} y={34} />
      </svg>
    </figure>
  )
}

function ModeTimeline({ segments }: { segments: ModeSegment[] }) {
  const width = 760
  const height = 210
  const margin = { bottom: 36, left: 96, right: 18, top: 20 }
  const xMax = Math.max(...segments.map(segment => segment.end), 1)
  const x = d3.scaleLinear().domain([0, xMax]).range([margin.left, width - margin.right])
  const modes = Array.from(new Set(segments.map(segment => segment.mode)))
  const laneY = d3.scalePoint<string>().domain(modes).range([52, height - margin.bottom - 24]).padding(0.5)
  const color = d3.scaleOrdinal<string, string>().domain(modes).range(["#17e7ff", "#8ee6a5", "#ffd166", "#ff8fb3", "#b69cff", "#f78c6b"])

  return (
    <figure className="gnc-dashboard-plot">
      <figcaption><strong>模式时间线</strong></figcaption>
      <svg className="gnc-d3-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="模式时间线">
        <g className="gnc-mode-bars">
          {segments.map(segment => (
            <line
              key={`${segment.mode}-${segment.start}`}
              x1={x(segment.start)}
              x2={x(segment.end)}
              y1={laneY(segment.mode)}
              y2={laneY(segment.mode)}
              stroke={color(segment.mode)}
              strokeWidth="8"
            />
          ))}
        </g>
        <g className="gnc-grid">
          {modes.map(mode => (
            <line key={mode} x1={margin.left} x2={width - margin.right} y1={laneY(mode)} y2={laneY(mode)} />
          ))}
        </g>
        <g className="gnc-axis">
          <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
          {x.ticks(6).map(tick => (
            <g key={`x-${tick}`} transform={`translate(${x(tick)},${height - margin.bottom})`}>
              <line y2="5" />
              <text y="20">{d3.format(".2f")(tick / 3600)}h</text>
            </g>
          ))}
          {modes.map(mode => (
            <g className="gnc-y-tick" key={mode} transform={`translate(${margin.left},${laneY(mode)})`}>
              <line x2="-5" />
              <text x="-9" dy="0.32em">{shortenLabel(mode, 12)}</text>
            </g>
          ))}
          <text className="gnc-axis-label" x={margin.left} y="12">mode</text>
        </g>
        <ChartLegend compact items={modes.map(mode => ({ color: color(mode), label: mode })).slice(0, 6)} x={width - 112} y={34} />
      </svg>
    </figure>
  )
}

export function GncTelemetryCharts({
  modeRows,
  mtbRows,
  scRows,
  wheelRows,
}: {
  modeRows: TelemetryRow[]
  mtbRows: TelemetryRow[]
  scRows: TelemetryRow[]
  wheelRows: TelemetryRow[]
}) {
  const angularRate = seriesFrom(scRows, "Sc_Time", [
    { key: "Sc_wn_1", label: "wx", scale: DEG },
    { key: "Sc_wn_2", label: "wy", scale: DEG },
    { key: "Sc_wn_3", label: "wz", scale: DEG },
  ])
  const inertialEuler = derivedEulerSeries(scRows, "inertial")
  const orbitEuler = derivedEulerSeries(scRows, "orbit")
  const wheelRpm = reactionWheelRpmSeries(wheelRows)
  const sunDiagnostic = diagnosticSeries(scRows)
  const mtbCommand = mtbCommandSeries(mtbRows)
  const segments = modeSegments(modeRows)

  return (
    <div className="gnc-dashboard-stack">
      <GncDashboardSummary modeRows={modeRows} scRows={scRows} />
      <div className="gnc-dashboard-grid">
        <LineChart series={angularRate} title="本体角速度" unit="deg/s" />
        <LineChart series={inertialEuler} title="惯性系姿态" unit="deg" />
        <LineChart series={orbitEuler} title="轨道系姿态误差" unit="deg" />
        <LineChart series={wheelRpm} title="飞轮转速" unit="rpm" />
        <ModeTimeline segments={segments} />
        <DiagnosticChart series={sunDiagnostic} />
        <LineChart series={mtbCommand} title="磁力矩器命令" unit="A m^2" />
      </div>
    </div>
  )
}

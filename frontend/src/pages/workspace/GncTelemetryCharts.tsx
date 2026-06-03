import * as d3 from "d3"

export type TelemetryRow = Record<string, number | string>

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

function num(row: TelemetryRow, key: string) {
  const value = row[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function str(row: TelemetryRow, key: string) {
  const value = row[key]
  return typeof value === "string" ? value : String(value ?? "")
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
  const height = 280
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

function ModeTimeline({ segments }: { segments: ModeSegment[] }) {
  const width = 760
  const height = 280
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

export function GncTelemetryCharts({ modeRows, scRows, wheelRows }: { modeRows: TelemetryRow[]; scRows: TelemetryRow[]; wheelRows: TelemetryRow[] }) {
  const angularRate = seriesFrom(scRows, "Sc_Time", [
    { key: "Sc_wn_1", label: "wx", scale: DEG },
    { key: "Sc_wn_2", label: "wy", scale: DEG },
    { key: "Sc_wn_3", label: "wz", scale: DEG },
  ])
  const inertialEuler = derivedEulerSeries(scRows, "inertial")
  const orbitEuler = derivedEulerSeries(scRows, "orbit")
  const wheelRpm = reactionWheelRpmSeries(wheelRows)
  const segments = modeSegments(modeRows)

  return (
    <div className="gnc-dashboard-grid">
      <LineChart series={angularRate} title="本体角速度" unit="deg/s" />
      <LineChart series={inertialEuler} title="惯性系姿态" unit="deg" />
      <LineChart series={orbitEuler} title="轨道系姿态误差" unit="deg" />
      <LineChart series={wheelRpm} title="飞轮转速" unit="rpm" />
      <ModeTimeline segments={segments} />
    </div>
  )
}

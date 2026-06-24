import { useMemo, useState } from "react"
import { joinApiPath } from "../../app/apiBase"
import type { WorkspaceVersionContext } from "./workspaceVersion"

const SEASONS = ["春分", "夏至", "秋分", "冬至"] as const
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"))
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"))
const SECONDS = MINUTES

type HeatfluxResult = {
  faces?: Record<string, number>
  image_relative_path?: string
  image_url?: string
  json_relative_path?: string
  matched_time?: string
  matched_time_s?: number
  orbit_phase_time?: string
  requested_time?: string
  season?: string
  source_version?: string
  updated_at?: string
}

type HeatfluxSelectorProps = {
  activeContext: WorkspaceVersionContext
  apiBase?: string
}

function buildQuery(activeContext: WorkspaceVersionContext) {
  const params = new URLSearchParams()
  if (activeContext.versionDir) params.set("workspaceDir", activeContext.versionDir)
  if (activeContext.workspaceId) params.set("workspaceId", activeContext.workspaceId)
  if (activeContext.versionId) params.set("versionId", activeContext.versionId)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function displayNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-"
}

function statusTone(status: string) {
  return /失败|错误|error/i.test(status) ? "bad" : /已|完成|写入|更新/.test(status) ? "ok" : "neutral"
}

function splitTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/u)
  const hour = Number.parseInt(match?.[1] ?? "0", 10)
  const minute = Number.parseInt(match?.[2] ?? "0", 10)
  const second = Number.parseInt(match?.[3] ?? "0", 10)
  return {
    hour: String(Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0).padStart(2, "0"),
    minute: String(Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0).padStart(2, "0"),
    second: String(Number.isFinite(second) ? Math.max(0, Math.min(59, second)) : 0).padStart(2, "0"),
  }
}

function formatTime(hour: string, minute: string, second: string) {
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`
}

export function HeatfluxSelector({ activeContext, apiBase }: HeatfluxSelectorProps) {
  const [season, setSeason] = useState<typeof SEASONS[number]>("春分")
  const [expanded, setExpanded] = useState(true)
  const [time, setTime] = useState("00:00:00")
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("选择季节和时刻生成轨道热流输入")
  const [result, setResult] = useState<HeatfluxResult | null>(null)
  const query = useMemo(() => buildQuery(activeContext), [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId])
  const tone = statusTone(status)
  const timeParts = splitTime(time)
  const imageVersion = result?.source_version ?? result?.updated_at ?? ""
  const imageUrl = result?.image_url ? `${result.image_url}${result.image_url.includes("?") ? "&" : "?"}v=${encodeURIComponent(imageVersion)}` : ""

  const updateTimePart = (part: "hour" | "minute" | "second", value: string) => {
    const next = { ...timeParts, [part]: value }
    setTime(formatTime(next.hour, next.minute, next.second))
  }

  const generate = () => {
    if (!activeContext.versionDir || pending) return
    setPending(true)
    setStatus("正在生成热流输入")
    fetch(`${joinApiPath(apiBase, "/workspace/heatflux/selection")}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, time }),
    })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "生成热流输入失败")
        return response.json() as Promise<HeatfluxResult>
      })
      .then(payload => {
        setResult(payload)
        setStatus("已更新热流参数")
      })
      .catch(error => setStatus(error instanceof Error ? error.message : "生成热流输入失败"))
      .finally(() => setPending(false))
  }

  return (
    <section className="catch-config-card heatflux-selector-card">
      <div className="catch-config-card-head">
        <div>
          <strong>轨道热流输入</strong>
          <span>{result?.matched_time ? `匹配时刻 ${result.matched_time}` : "晨昏轨道四季热流曲线"}</span>
        </div>
        <div className="heatflux-head-actions">
          <div className={`heatflux-status is-${tone}`}>{status}</div>
          <button type="button" className="heatflux-collapse-button" onClick={() => setExpanded(value => !value)}>
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </div>

      {expanded ? (
        <>
          <div className="heatflux-controls">
            <label>
              <span>季节节点</span>
              <select value={season} onChange={event => setSeason(event.target.value as typeof SEASONS[number])}>
                {SEASONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="heatflux-time-field">
              <span>轨道时刻</span>
              <div className="heatflux-time-picker">
                <select aria-label="轨道小时" value={timeParts.hour} onChange={event => updateTimePart("hour", event.target.value)}>
                  {HOURS.map(option => <option key={option} value={option}>{option} 时</option>)}
                </select>
                <select aria-label="轨道分钟" value={timeParts.minute} onChange={event => updateTimePart("minute", event.target.value)}>
                  {MINUTES.map(option => <option key={option} value={option}>{option} 分</option>)}
                </select>
                <select aria-label="轨道秒" value={timeParts.second} onChange={event => updateTimePart("second", event.target.value)}>
                  {SECONDS.map(option => <option key={option} value={option}>{option} 秒</option>)}
                </select>
                <input
                  aria-label="轨道时刻直接输入"
                  value={time}
                  onChange={event => setTime(event.target.value)}
                  placeholder="HH:mm:ss"
                />
              </div>
            </label>
            <button type="button" className="primary" onClick={generate} disabled={!activeContext.versionDir || pending}>
              {pending ? "生成中" : "生成热流输入"}
            </button>
          </div>

          {result ? (
            <div className="heatflux-result-grid">
              <div className="heatflux-json-panel">
                <div className="heatflux-mini-title">
                  <strong>六面热流</strong>
                  <span>W/m²</span>
                </div>
                <pre>{JSON.stringify({
                  season: result.season,
                  requested_time: result.requested_time,
                  orbit_phase_time: result.orbit_phase_time,
                  matched_time: result.matched_time,
                  faces: result.faces,
                }, null, 2)}</pre>
              </div>
              <div className="heatflux-image-panel">
                <div className="heatflux-mini-title">
                  <strong>热流图</strong>
                  <span>{result.image_relative_path ?? "00_inputs/heatflux/heatflux_curve.png"}</span>
                </div>
                {imageUrl ? <img src={imageUrl} alt="热流曲线" /> : null}
              </div>
              <div className="heatflux-face-strip">
                {["+X", "-X", "+Y", "-Y", "+Z", "-Z"].map(face => (
                  <div key={face}>
                    <span>{face}</span>
                    <strong>{displayNumber(result.faces?.[face])}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

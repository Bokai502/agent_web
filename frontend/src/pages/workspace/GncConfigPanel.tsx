import { useState } from "react"

const GNC_MODE_OPTIONS = ["对日定向", "对地定向", "惯性指向", "安全模式"]
const SENSOR_OPTIONS = ["星敏 + 陀螺", "陀螺 + 磁强计", "太阳敏感器 + 陀螺"]

export function GncConfigPanel() {
  const [controlMode, setControlMode] = useState(GNC_MODE_OPTIONS[1])
  const [sensorSet, setSensorSet] = useState(SENSOR_OPTIONS[0])
  const [targetAngle, setTargetAngle] = useState(12)
  const [simDuration, setSimDuration] = useState(600)
  const [useReactionWheel, setUseReactionWheel] = useState(true)
  const [useMagTorquer, setUseMagTorquer] = useState(true)
  const [caseName, setCaseName] = useState("LEO_Nadir_Tracking")

  return (
    <section className="wa-info-card gnc-config-card">
      <h3>配置参数</h3>
      <p>姿轨控任务前端参数预览</p>

      <div className="gnc-config-list">
        <label className="gnc-config-row">
          <span>控制模式</span>
          <select value={controlMode} onChange={event => setControlMode(event.target.value)}>
            {GNC_MODE_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
        </label>

        <label className="gnc-config-row">
          <span>传感器组合</span>
          <select value={sensorSet} onChange={event => setSensorSet(event.target.value)}>
            {SENSOR_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
        </label>

        <div className="gnc-config-row">
          <span>目标姿态角</span>
          <div className="gnc-stepper">
            <button type="button" onClick={() => setTargetAngle(value => Math.max(0, value - 1))}>−</button>
            <strong>{targetAngle}</strong>
            <button type="button" onClick={() => setTargetAngle(value => Math.min(180, value + 1))}>＋</button>
          </div>
          <small>deg</small>
        </div>

        <div className="gnc-config-row">
          <span>仿真时长</span>
          <div className="gnc-stepper">
            <button type="button" onClick={() => setSimDuration(value => Math.max(60, value - 60))}>−</button>
            <strong>{simDuration}</strong>
            <button type="button" onClick={() => setSimDuration(value => Math.min(7200, value + 60))}>＋</button>
          </div>
          <small>s</small>
        </div>

        <div className="gnc-config-row">
          <span>反作用飞轮</span>
          <button
            type="button"
            className={`gnc-switch${useReactionWheel ? " active" : ""}`}
            aria-pressed={useReactionWheel}
            onClick={() => setUseReactionWheel(value => !value)}
          >
            <span />
          </button>
        </div>

        <div className="gnc-config-row">
          <span>磁力矩器卸载</span>
          <button
            type="button"
            className={`gnc-switch${useMagTorquer ? " active" : ""}`}
            aria-pressed={useMagTorquer}
            onClick={() => setUseMagTorquer(value => !value)}
          >
            <span />
          </button>
        </div>

        <label className="gnc-config-row">
          <span>任务算例</span>
          <input value={caseName} onChange={event => setCaseName(event.target.value)} />
        </label>

        <div className="gnc-config-row gnc-config-capacity">
          <span>预计收敛裕度</span>
          <strong>28.5 deg / 45 deg</strong>
        </div>
      </div>
    </section>
  )
}

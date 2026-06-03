type RemoteToolName = 'cad' | 'comsol' | 'paraview'

const NOVNC_URL_PARAMS = 'vnc.html?autoconnect=true&resize=scale&path=websockify'
const DEFAULT_TOOL_PORTS: Record<RemoteToolName, number> = {
  cad: 6080,
  comsol: 6082,
  paraview: 6081,
}

export const runtimeConfig = typeof __APP_CONFIG__ === 'object' && __APP_CONFIG__ ? __APP_CONFIG__ : {}

export function getRemoteToolUrl(tool: RemoteToolName, host: string) {
  const configured = runtimeConfig.tools?.[tool]
  if (configured?.url) return configured.url
  const port = configured?.noVncPort ?? DEFAULT_TOOL_PORTS[tool]
  return `http://${host}:${port}/${NOVNC_URL_PARAMS}`
}

export function getGncToolUrl() {
  return runtimeConfig.tools?.gnc?.url ?? 'http://10.110.10.11:8765/'
}

export function getGncTelemetryPaths() {
  const configured = runtimeConfig.gnc?.dashboard?.telemetryPaths ?? {}
  return {
    mode: configured.mode ?? '02_sim/42_run/runtime_case/InOut/ModeTrace_SC0.csv',
    sc: configured.sc ?? '02_sim/42_run/runtime_case/InOut/Sc.csv',
    wheel: configured.wheel ?? '02_sim/42_run/runtime_case/InOut/AcWhl.csv',
  }
}

export function getGncTelemetryMaxBytes() {
  return runtimeConfig.gnc?.dashboard?.telemetryMaxBytes ?? 8 * 1024 * 1024
}

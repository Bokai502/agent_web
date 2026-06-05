type RemoteToolName = 'cad' | 'comsol' | 'paraview'

const NOVNC_URL_PARAMS = 'vnc.html?autoconnect=true&resize=scale&path=websockify'

export const runtimeConfig = typeof __APP_CONFIG__ === 'object' && __APP_CONFIG__ ? __APP_CONFIG__ : {}

export function getBackendPort() {
  return runtimeConfig.server?.port
}

export function getRemoteToolUrl(tool: RemoteToolName, host: string) {
  const configured = runtimeConfig.tools?.[tool]
  if (configured?.url) return configured.url
  const port = configured?.noVncPort
  if (!port) return 'about:blank'
  return `http://${host}:${port}/${NOVNC_URL_PARAMS}`
}

export function getGncToolUrl() {
  return runtimeConfig.tools?.gnc?.url ?? 'about:blank'
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

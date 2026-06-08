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
    hwhl: configured.hwhl ?? '02_sim/42_run/runtime_case/InOut/Hwhl.42',
    modeSummary: configured.modeSummary ?? 'AIGNC_Workflow/08_run/run_summary.json',
    mtb: configured.mtb ?? '02_sim/42_run/runtime_case/InOut/MTB.42',
    posn: configured.posn ?? '02_sim/42_run/runtime_case/InOut/PosN.42',
    qbn: configured.qbn ?? '02_sim/42_run/runtime_case/InOut/qbn.42',
    time: configured.time ?? '02_sim/42_run/runtime_case/InOut/time.42',
    veln: configured.veln ?? '02_sim/42_run/runtime_case/InOut/VelN.42',
    wbn: configured.wbn ?? '02_sim/42_run/runtime_case/InOut/wbn.42',
  }
}

export function getGncTelemetryMaxBytes() {
  return runtimeConfig.gnc?.dashboard?.telemetryMaxBytes ?? 8 * 1024 * 1024
}

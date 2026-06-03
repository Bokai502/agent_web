/// <reference types="vite/client" />

declare const __BACKEND_PORT__: number
declare const __APP_CONFIG__: {
  gnc?: {
    dashboard?: {
      telemetryMaxBytes?: number
      telemetryPaths?: {
        mode?: string
        sc?: string
        wheel?: string
      }
    }
  }
  tools?: {
    comsol?: {
      noVncPort?: number
      url?: string
    }
    gnc?: {
      url?: string
    }
    paraview?: {
      noVncPort?: number
      url?: string
    }
    cad?: {
      noVncPort?: number
      url?: string
    }
  }
}

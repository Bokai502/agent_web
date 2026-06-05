/// <reference types="vite/client" />

declare const __APP_CONFIG__: {
  frontend?: {
    host?: string
    port?: number
    httpsPort?: number
    publicHost?: string
    strictPort?: boolean
  }
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
  server?: {
    port?: number
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

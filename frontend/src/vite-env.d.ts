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
        hwhl?: string
        modeSummary?: string
        mtb?: string
        posn?: string
        qbn?: string
        time?: string
        veln?: string
        wbn?: string
      }
    }
  }
  server?: {
    port?: number
  }
  tools?: {
    remoteDesktopLauncher?: string
    comsol?: {
      displayNum?: string
      launcher?: string
      noVncPort?: number
      sudo?: string
      url?: string
      vncPort?: number
    }
    gnc?: {
      url?: string
    }
    paraview?: {
      displayNum?: string
      launcher?: string
      noVncPort?: number
      url?: string
      vncPort?: number
    }
    cad?: {
      bin?: string
      displayNum?: string
      launcher?: string
      noVncPort?: number
      url?: string
      vncPort?: number
    }
  }
}

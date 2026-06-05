import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import basicSsl from "@vitejs/plugin-basic-ssl"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

type RootConfig = {
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
  frontend?: {
    host?: string
    port?: number
    httpsPort?: number
    publicHost?: string
    strictPort?: boolean
  }
  tools?: {
    cad?: { bin?: string; displayNum?: string; launcher?: string; noVncPort?: number; url?: string; vncPort?: number }
    comsol?: { displayNum?: string; launcher?: string; noVncPort?: number; sudo?: string; url?: string; vncPort?: number }
    gnc?: { url?: string }
    paraview?: { displayNum?: string; launcher?: string; noVncPort?: number; url?: string; vncPort?: number }
    remoteDesktopLauncher?: string
  }
}

function loadRootConfig(): RootConfig {
  const configPath = path.resolve(__dirname, "..", "config.json")
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RootConfig
  } catch {
    return {}
  }
}

function requiredPort(value: unknown, field: string) {
  const port = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${field} must be a positive integer in config.json`)
  }
  return port
}

export default defineConfig(({ mode }) => {
  const useHttps = mode === "https-dev"
  const rootConfig = loadRootConfig()
  const envBackendPort = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : null
  const backendPort = envBackendPort && Number.isInteger(envBackendPort) && envBackendPort > 0
    ? envBackendPort
    : requiredPort(rootConfig.server?.port, "server.port")
  const frontend = rootConfig.frontend ?? {}
  const frontendPort = requiredPort(frontend.port, "frontend.port")
  const frontendHttpsPort = requiredPort(frontend.httpsPort, "frontend.httpsPort")
  const publicConfig = {
    frontend: rootConfig.frontend,
    gnc: rootConfig.gnc,
    server: {
      port: backendPort,
    },
    tools: rootConfig.tools,
  }

  return {
    define: {
      __APP_CONFIG__: JSON.stringify(publicConfig),
    },
    plugins: [
      tailwindcss(),
      react(),
      useHttps && basicSsl(),
    ].filter(Boolean),
    server: {
      host: frontend.host ?? "0.0.0.0",
      port: useHttps ? frontendHttpsPort : frontendPort,
      strictPort: frontend.strictPort ?? true,
      ...(useHttps ? { https: {} } : {}),
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    assetsInclude: ["**/*.glb"],
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined

            if (id.includes("three/examples")) {
              return "three-extras"
            }

            if (id.includes("three/tsl")) {
              return "three-tsl"
            }

            if (id.includes("three/webgpu")) {
              return "three-webgpu"
            }

            if (id.includes("/node_modules/three/")) {
              return "three-runtime"
            }

            if (id.includes("react-markdown") || id.includes("remark-gfm")) {
              return "markdown-vendor"
            }

            if (id.includes("react-dom") || id.includes("/react/")) {
              return "react-vendor"
            }

            return "vendor"
          },
        },
      },
    },
  }
})

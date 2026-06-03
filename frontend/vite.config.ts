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
    strictPort?: boolean
  }
  tools?: {
    cad?: { noVncPort?: number; url?: string }
    comsol?: { noVncPort?: number; url?: string }
    gnc?: { url?: string }
    paraview?: { noVncPort?: number; url?: string }
  }
}

const DEFAULT_BACKEND_PORT = 3001

function loadRootConfig(): RootConfig {
  const configPath = path.resolve(__dirname, "..", "config.json")
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RootConfig
  } catch {
    return {}
  }
}

export default defineConfig(({ mode }) => {
  const useHttps = mode === "https-dev"
  const rootConfig = loadRootConfig()
  const envBackendPort = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : null
  const backendPort = envBackendPort && Number.isInteger(envBackendPort) && envBackendPort > 0
    ? envBackendPort
    : rootConfig.server?.port ?? DEFAULT_BACKEND_PORT
  const frontend = rootConfig.frontend ?? {}
  const publicConfig = {
    gnc: rootConfig.gnc,
    tools: rootConfig.tools,
  }

  return {
    define: {
      __BACKEND_PORT__: JSON.stringify(backendPort),
      __APP_CONFIG__: JSON.stringify(publicConfig),
    },
    plugins: [
      tailwindcss(),
      react(),
      useHttps && basicSsl(),
    ].filter(Boolean),
    server: {
      host: frontend.host ?? "0.0.0.0",
      port: useHttps ? (frontend.httpsPort ?? 5175) : (frontend.port ?? 5174),
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
